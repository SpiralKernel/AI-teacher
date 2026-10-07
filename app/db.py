import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.curriculum import NODES, VERSION
from app.questions import make_question, validate_question
from app.question_types import ensure_templates


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


@contextmanager
def connect(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def audit(db, kind: str, details: dict):
    db.execute("INSERT INTO audit_events(kind,details,created_at) VALUES(?,?,?)", (kind, dumps(details), now()))


def initialize(path: Path):
    with connect(path) as db:
        db.execute("PRAGMA journal_mode = WAL")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version > 3:
            raise RuntimeError("数据库版本高于应用支持版本，拒绝降级打开。")
        if version == 0:
            db.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE knowledge(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE questions(
                    id TEXT PRIMARY KEY, knowledge_id TEXT NOT NULL REFERENCES knowledge(id),
                    content_hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE seed_state(knowledge_id TEXT PRIMARY KEY REFERENCES knowledge(id), next_index INTEGER NOT NULL);
                CREATE TABLE students(id TEXT PRIMARY KEY, nickname TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE attempts(
                    id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
                    question_id TEXT NOT NULL REFERENCES questions(id), status TEXT NOT NULL DEFAULT 'assigned'
                    CHECK(status IN ('assigned','submitted','skipped')),
                    hint_used INTEGER NOT NULL DEFAULT 0, answer TEXT, result TEXT,
                    assigned_at TEXT NOT NULL, submitted_at TEXT);
                CREATE UNIQUE INDEX one_active_attempt ON attempts(student_id) WHERE status='assigned';
                CREATE INDEX attempts_student ON attempts(student_id,submitted_at);
                CREATE TABLE mastery(
                    student_id TEXT NOT NULL REFERENCES students(id),
                    knowledge_id TEXT NOT NULL REFERENCES knowledge(id),
                    success REAL NOT NULL DEFAULT 0, failure REAL NOT NULL DEFAULT 0,
                    attempts INTEGER NOT NULL DEFAULT 0, last_seen TEXT,
                    PRIMARY KEY(student_id,knowledge_id));
                CREATE TABLE tutor_messages(
                    id INTEGER PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id),
                    user_message TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE audit_events(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
                PRAGMA user_version = 1;
                COMMIT;
            """)
        if version < 2:
            db.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE imports(
                    id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id),
                    title TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('completed','blank')),
                    status TEXT NOT NULL CHECK(status IN ('uploaded','processing','review','confirmed','failed')),
                    page_count INTEGER NOT NULL,source_files TEXT NOT NULL,error TEXT,
                    model TEXT,created_at TEXT NOT NULL,confirmed_at TEXT);
                CREATE TABLE import_pages(
                    import_id TEXT NOT NULL REFERENCES imports(id),page_number INTEGER NOT NULL,
                    file_name TEXT NOT NULL,source_label TEXT NOT NULL,
                    PRIMARY KEY(import_id,page_number));
                CREATE TABLE import_items(
                    id TEXT PRIMARY KEY,import_id TEXT NOT NULL REFERENCES imports(id),
                    position INTEGER NOT NULL,data TEXT NOT NULL);
                CREATE TABLE import_evidence(
                    item_id TEXT PRIMARY KEY REFERENCES import_items(id),
                    import_id TEXT NOT NULL REFERENCES imports(id),student_id TEXT NOT NULL REFERENCES students(id),
                    fingerprint TEXT NOT NULL,knowledge_ids TEXT NOT NULL,
                    verdict TEXT NOT NULL CHECK(verdict IN ('correct','incorrect')),
                    weight REAL NOT NULL CHECK(weight>0 AND weight<=0.5),created_at TEXT NOT NULL,
                    UNIQUE(student_id,fingerprint));
                CREATE TABLE import_messages(
                    id INTEGER PRIMARY KEY,item_id TEXT NOT NULL REFERENCES import_items(id),
                    user_message TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE INDEX import_student ON imports(student_id,created_at);
                PRAGMA user_version = 2;
                COMMIT;
            """)
        if version < 3:
            db.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE question_types(id TEXT PRIMARY KEY,subject TEXT NOT NULL,
                    grade INTEGER NOT NULL,term INTEGER NOT NULL,normalized_name TEXT NOT NULL,data TEXT NOT NULL,
                    UNIQUE(subject,grade,term,normalized_name));
                CREATE TABLE challenge_state(knowledge_id TEXT PRIMARY KEY REFERENCES knowledge(id),next_index INTEGER NOT NULL);
                PRAGMA user_version = 3;
                COMMIT;
            """)
        db.execute("BEGIN IMMEDIATE")
        for node in NODES:
            db.execute("INSERT INTO knowledge VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                       (node["id"], dumps(node)))
            db.execute("INSERT OR IGNORE INTO seed_state VALUES(?,0)", (node["id"],))
            db.execute("INSERT OR IGNORE INTO challenge_state VALUES(?,0)", (node["id"],))
        db.execute("INSERT OR IGNORE INTO students VALUES('demo','学习者',?)", (now(),))
        ensure_templates(db)
        audit(db, "curriculum_sync", {"version": VERSION, "nodes": len(NODES)})
        replenish(db)


def replenish(db, minimum: int = 6) -> int:
    """为演示学生补足未做题；最多尝试 400 个参数，防止有限题型耗尽时死循环。"""
    added = 0
    for node in NODES:
        available = db.execute("""SELECT COUNT(*) FROM questions q WHERE knowledge_id=? AND json_extract(q.data,'$.difficulty')<3 AND NOT EXISTS
            (SELECT 1 FROM attempts a WHERE a.question_id=q.id AND a.student_id='demo' AND a.status='submitted')""",
                               (node["id"],)).fetchone()[0]
        needed = max(0, minimum - available)
        index = db.execute("SELECT next_index FROM seed_state WHERE knowledge_id=?", (node["id"],)).fetchone()[0]
        for _ in range(400 if needed else 0):
            q = make_question(node["id"], index)
            index += 1
            if not validate_question(q):
                raise ValueError("题目未通过校验")
            content_hash = hashlib.sha256(q["stem"].encode()).hexdigest()
            cursor = db.execute("INSERT OR IGNORE INTO questions VALUES(?,?,?,?,?)",
                                (q["id"], node["id"], content_hash, dumps(q), now()))
            added += cursor.rowcount
            needed -= cursor.rowcount
            if needed <= 0:
                break
        db.execute("UPDATE seed_state SET next_index=? WHERE knowledge_id=?", (index, node["id"]))
        from app.challenges import make_challenge
        available = db.execute("""SELECT COUNT(*) FROM questions q WHERE knowledge_id=? AND json_extract(q.data,'$.difficulty')=3 AND NOT EXISTS
            (SELECT 1 FROM attempts a WHERE a.question_id=q.id AND a.student_id='demo' AND a.status='submitted')""", (node["id"],)).fetchone()[0]
        needed = max(0, 2-available)
        index = db.execute("SELECT next_index FROM challenge_state WHERE knowledge_id=?", (node["id"],)).fetchone()[0]
        for _ in range(100 if needed else 0):
            q = make_challenge(node["id"], index)
            index += 1
            cursor = db.execute("INSERT OR IGNORE INTO questions VALUES(?,?,?,?,?)", (q["id"], node["id"], hashlib.sha256(q["stem"].encode()).hexdigest(), dumps(q), now()))
            added += cursor.rowcount
            needed -= cursor.rowcount
            if needed <= 0:break
        db.execute("UPDATE challenge_state SET next_index=? WHERE knowledge_id=?", (index, node["id"]))
    if added:
        audit(db, "verified_question_replenishment", {"added": added, "template_version": "1"})
    return added
