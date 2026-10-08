"""课程目标、学习进度与有来源的题目候选映射。

课程画像是练习证据摘要，不把候选标签匹配当作教材或教师认证。
"""
import hashlib
import json
import unicodedata
from collections import defaultdict

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app.course_catalog import BOOKS, BOOK_MAP, GOALS, UNITS, VERSION
from app.db import audit, dumps, now


class CourseSetting(BaseModel):
    subject: str = Field(max_length=30)
    book_id: str = Field(max_length=80)
    unit_id: str | None = Field(default=None, max_length=100)


def normalize(text):
    return "".join(unicodedata.normalize("NFKC", text).casefold().split())


def validate_scope(subject, book_id=None, unit_id=None):
    if book_id and (book_id not in BOOK_MAP or BOOK_MAP[book_id]["subject"] != subject):
        raise HTTPException(422, "课程册次与科目不匹配")
    if unit_id and (unit_id not in UNITS or not book_id or not unit_id.startswith(book_id + ":")):
        raise HTTPException(422, "请选择该册已有的单元")


def catalog(subject):
    items = [b for b in BOOKS if b["subject"] == subject]
    if not items:
        raise HTTPException(422, "课程科目不存在")
    return {"version": VERSION, "books": items,
            "note": "课标规定学段要求；标为课标进阶的学期拆分是项目建议，可按学校进度调整。"}


def get_setting(db, subject):
    catalog(subject)
    row = db.execute("SELECT data FROM course_settings WHERE student_id='demo' AND subject=?", (subject,)).fetchone()
    if row:
        value = json.loads(row[0])
        if value["book_id"] in BOOK_MAP:
            return value
    first = next(b for b in BOOKS if b["subject"] == subject)
    return {"subject": subject, "book_id": first["id"], "unit_id": None}


def set_setting(db, body):
    validate_scope(body.subject, body.book_id, body.unit_id)
    value = body.model_dump()
    db.execute("INSERT INTO course_settings VALUES('demo',?,?) ON CONFLICT(student_id,subject) DO UPDATE SET data=excluded.data",
               (body.subject, dumps(value)))
    audit(db, "course_progress_changed", value)
    return value


def matched_goals(q):
    """只匹配来源知识标签，不根据题干猜学期，也不修改来源年级或标签。"""
    if q.get("stage") != "junior":
        return []
    labels = {normalize(str(t)) for t in q.get("knowledge_tags", [])}
    found = []
    for target in GOALS.values():
        if target["subject"] != q["subject"]:
            continue
        matches = []
        for alias in target["aliases"]:
            key = normalize(alias)
            if any(key == label or (len(key) >= 3 and key in label) for label in labels):
                matches.append(alias)
        if matches:
            found.append((target["id"], matches))
    return found


def sync_questions(db, question_ids=None, force=False):
    """由启动/入库触发，映射可重建；同版本仅检查新增或换标签的题。"""
    # 历史快照也需要当前目标映射，退出推荐不应让已有作答证据消失。
    rows = db.execute("SELECT id,data FROM bank_questions").fetchall() if question_ids is None else [
        r for qid in question_ids if (r := db.execute("SELECT id,data FROM bank_questions WHERE id=?", (qid,)).fetchone())]
    existing = {r["question_id"]: r["signature"] for r in db.execute("SELECT * FROM course_mapping_state")}
    changed = 0
    for row in rows:
        q = json.loads(row["data"])
        signature = hashlib.sha256(dumps([VERSION, q["subject"], q["stage"], q.get("knowledge_tags", [])]).encode()).hexdigest()
        if not force and existing.get(row["id"]) == signature:
            continue
        db.execute("DELETE FROM course_question_links WHERE question_id=?", (row["id"],))
        for goal_id, aliases in matched_goals(q):
            db.execute("INSERT INTO course_question_links VALUES(?,?,?,?)",
                       (row["id"], goal_id, VERSION, dumps({"method": "source_knowledge_alias", "matched_aliases": aliases, "needs_review": True})))
        db.execute("INSERT INTO course_mapping_state VALUES(?,?) ON CONFLICT(question_id) DO UPDATE SET signature=excluded.signature",
                   (row["id"], signature))
        changed += 1
    if changed:
        audit(db, "course_mapping_sync", {"version": VERSION, "questions": changed})
    return changed


def scope_goals(book_id, unit_id=None):
    return [g for u in BOOK_MAP[book_id]["units"] if not unit_id or u["id"] == unit_id for g in u["goals"]]


def evidence(db, subject):
    result = defaultdict(list)
    rows = db.execute("""SELECT l.goal_id,a.id,a.result,a.question_id,q.data FROM bank_attempts a
        JOIN bank_questions q ON q.id=a.question_id JOIN course_question_links l ON l.question_id=q.id
        WHERE a.student_id='demo' AND a.status='submitted' AND q.subject=? AND l.version=?""", (subject, VERSION))
    for row in rows:
        value, q = json.loads(row["result"]), json.loads(row["data"])
        if value.get("evidence_weight", 0) <= 0:
            continue
        # 来源同一题的不同快照不重复作为同目标证据。
        origin = q.get("provenance", {})
        identity = str(origin.get("dataset", q.get("id", ""))) + ":" + str(origin.get("source_id", row["question_id"]))
        result[row["goal_id"]].append({"id": "bank:" + row["id"], "question_identity": identity,
                                      "correct": value["correct"], "weight": value["evidence_weight"],
                                      "types": [t["id"] for t in q["tags"] if t["kind"] == "type"]})
    if subject == "math":
        targets = defaultdict(list)
        for g in GOALS.values():
            for node_id in g["legacy_ids"]:
                targets[node_id].append(g["id"])
        for row in db.execute("SELECT a.id,a.question_id,a.result,q.knowledge_id FROM attempts a JOIN questions q ON q.id=a.question_id WHERE student_id='demo' AND status='submitted'"):
            value = json.loads(row["result"])
            if value.get("evidence_weight", 0) <= 0:
                continue
            for gid in targets[row["knowledge_id"]]:
                result[gid].append({"id": "legacy:" + row["id"], "question_identity": row["question_id"],
                                    "correct": value["correct"], "weight": value["evidence_weight"],
                                    "types": [value.get("question_type_id", row["knowledge_id"])]})
        for row in db.execute("SELECT item_id,fingerprint,knowledge_ids,verdict,weight FROM import_evidence WHERE student_id='demo'"):
            for node_id in json.loads(row["knowledge_ids"]):
                for gid in targets[node_id]:
                    result[gid].append({"id": "import:" + row["item_id"], "question_identity": row["fingerprint"],
                                        "correct": row["verdict"] == "correct", "weight": row["weight"], "types": []})
    return result


def report(db, subject, book_id=None, unit_id=None):
    setting = get_setting(db, subject)
    if not book_id:
        book_id, unit_id = setting["book_id"], setting["unit_id"]
    validate_scope(subject, book_id, unit_id)
    book = BOOK_MAP[book_id]
    all_evidence = evidence(db, subject)
    counts = {r["goal_id"]: r["n"] for r in db.execute("""SELECT l.goal_id,COUNT(*) n FROM course_question_links l
        JOIN bank_questions q ON q.id=l.question_id WHERE q.status!='superseded' AND json_extract(q.data,'$.can_practice')=1
        AND l.version=? GROUP BY l.goal_id""", (VERSION,))}
    targets = []
    for target in scope_goals(book_id, unit_id):
        unique = {}
        for item in all_evidence[target["id"]]:
            unique.setdefault(item["question_identity"], item)
        items = list(unique.values())
        success = sum(x["weight"] for x in items if x["correct"])
        failure = sum(x["weight"] for x in items if not x["correct"])
        mastery = round((1 + success) / (2 + success + failure), 3) if items else None
        types = {tid for x in items for tid in x["types"]}
        status = ("待诊断" if not items else "证据不足" if len(items) < 3 else
                  "需要巩固" if mastery < .6 else "练习表现较稳" if mastery >= .8 and len(types) >= 2 and not target["practical"] else "继续检查")
        targets.append({**target, "unit_name": UNITS[target["unit_id"]]["name"], "attempts": len(items),
                        "success_weight": success, "failure_weight": failure, "mastery": mastery,
                        "status": status, "type_count": len(types), "question_count": counts.get(target["id"], 0),
                        "evidence_ids": [i["id"] for i in items], "coverage_review_required": True})
    return {"version": VERSION, "setting": setting, "book": book, "unit_id": unit_id, "goals": targets,
            "summary": {"total": len(targets), "diagnosed": sum(g["attempts"] > 0 for g in targets),
                        "unassessed": sum(g["attempts"] == 0 for g in targets),
                        "needs_practice": sum(g["status"] == "需要巩固" for g in targets),
                        "no_questions": sum(g["question_count"] == 0 for g in targets)},
            "note": "目标下题目按来源知识标签匹配，待核对覆盖。练习表现不等于整项目标达标；实验、朗读和项目实践需要另行观察。"}


def context(db, subject, q=None, book_id=None, unit_id=None):
    value = report(db, subject, book_id, unit_id)
    targets = value["goals"]
    related_ids = set()
    if q:
        related_ids = {g[0] for g in matched_goals(q)}
        if q.get("knowledge_id"):
            related_ids |= {g["id"] for g in GOALS.values() if q["knowledge_id"] in g["legacy_ids"]}
    ranked = sorted(targets, key=lambda g: (g["id"] not in related_ids, g["mastery"] is not None, g["mastery"] or 0))
    return {"version": VERSION, "subject": subject, "grade": value["book"]["grade"], "term": value["book"]["term"],
            "edition": value["book"]["edition"], "basis": value["book"]["basis"], "scope_note": value["book"]["scope_note"],
            "book_id": value["book"]["id"], "unit_id": value["unit_id"], "summary": value["summary"],
            "stage_outcomes": value["book"]["stage_outcomes"],
            "goals": [{k: g[k] for k in ("id", "unit_id", "name", "can_do", "checks", "prerequisites", "practical", "status", "attempts", "question_count")}
                      for g in ranked],
            "question_relation": "候选目标匹配" if related_ids & {g["id"] for g in targets} else "当前目标范围外或尚未映射" if q else None,
            "guidance": "先依据当前阶段目标诊断；待诊断不是不会。候选题不证明目标完整覆盖。不得把其他版本或后续学期知识当作已学前提；超出范围时说明并询问是否讲解前置知识。"}
