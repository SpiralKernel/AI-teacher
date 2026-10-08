"""多科题库：来源快照、标签筛选、作答与分题型证据。"""
import hashlib
import json
import random
import re
import unicodedata
import uuid

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app.db import audit, dumps, now
from app.identity import scope, book_id

SUBJECTS = {
    "math": "数学", "chinese": "语文", "english": "英语", "physics": "物理",
    "chemistry": "化学", "biology": "生物", "history": "历史", "geography": "地理",
    "politics": "道德与法治", "science": "科学", "information": "信息技术",
}
STAGES = {"junior": "初中", "primary": "小学", "senior": "高中", "unknown": "学段待核对"}


class Selection(BaseModel):
    subject: str = "math"
    stage: str = "junior"
    tag_id: str | None = Field(default=None, max_length=100)
    difficulty: int | None = Field(default=None, ge=1, le=3)
    answer_mode: str | None = None
    source_id: str | None = Field(default=None, max_length=50)
    question_id: str | None = Field(default=None, max_length=160)
    allow_challenge: bool = False
    course_book_id: str | None = Field(default=None, max_length=80)
    course_unit_id: str | None = Field(default=None, max_length=100)


def normalized(value):
    return "".join(unicodedata.normalize("NFKC", value).split()).casefold()


def register_tag(db, subject, stage, kind, label, origin="source"):
    label = unicodedata.normalize("NFKC", label).strip()[:500]
    tag_id = "tag:" + hashlib.sha256(f"{subject}:{stage}:{kind}:{normalized(label)}".encode()).hexdigest()[:24]
    db.execute("INSERT OR IGNORE INTO bank_taxonomy VALUES(?,?,?,?,?,?,?)",
               (tag_id, subject, stage, kind, label, origin, int(origin in {"ai", "luna", "heuristic"})))
    return tag_id


def import_records(db, dataset, records, manifest):
    """一批一个事务；不覆盖已发布快照，反复导入不重复创建题目或标签。"""
    db.execute("BEGIN IMMEDIATE")
    db.execute("INSERT INTO bank_sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET manifest=excluded.manifest,imported_at=excluded.imported_at", (dataset, dumps(manifest), now()))
    counts = {"read": 0, "inserted": 0, "duplicates": 0, "ready": 0, "reference": 0, "quarantine": 0}
    inserted_ids = []
    for raw in records:
        q = dict(raw)
        counts["read"] += 1
        if q["subject"] not in SUBJECTS or q["stage"] not in STAGES:
            raise ValueError("不支持的科目或学段")
        # 题干相同但选项不同应保留；跨文件相同题按内容去重。
        digest = hashlib.sha256(normalized(q["stage"] + q["stem"] + dumps(q.get("options", [])) + str(q.get("answer", ""))).encode()).hexdigest()
        existing = db.execute("SELECT id,data FROM bank_questions WHERE subject=? AND content_hash=?", (q["subject"], digest)).fetchone()
        if existing:
            if json.loads(existing["data"])["kind"]==q["kind"]:
                counts["duplicates"] += 1
                continue
            digest=hashlib.sha256((digest+q["kind"]).encode()).hexdigest()
            if db.execute("SELECT 1 FROM bank_questions WHERE subject=? AND content_hash=?",(q["subject"],digest)).fetchone():
                counts["duplicates"]+=1
                continue
        prior=db.execute("SELECT data FROM bank_questions WHERE id=?", (q["id"],)).fetchone()
        if prior:
            for version in db.execute("SELECT id,data FROM bank_questions WHERE id=? OR id LIKE ?",(q["id"],q["id"]+":%")).fetchall():
                old=json.loads(version["data"])
                old.update(can_practice=False,status="superseded")
                old["issues"]=[*old.get("issues",[]),"superseded_source_version"]
                db.execute("UPDATE bank_questions SET status='superseded',data=? WHERE id=?",(dumps(old),version["id"]))
            q["id"] += ":" + digest[:12]
        q["answer_mode"] = "choice" if q["kind"] in {"single_choice", "multiple_choice"} else "written"
        q["has_missing_assets"] = bool(q.get("has_missing_assets", False))
        q["can_practice"] = q["status"] != "quarantine" and bool(q["stem"].strip()) and bool(str(q.get("answer", "")).strip()) and not q["has_missing_assets"]
        if any(re.search(r"缺.*图|missing.*(?:image|asset)|requires_asset_review", str(issue), re.I) for issue in q.get("issues", [])):
            q["can_practice"] = False
            q["has_missing_assets"] = True
        tags = []
        for kind, field in (("knowledge", "knowledge_tags"), ("type", "type_tags")):
            for label in dict.fromkeys(q.get(field, [])):
                if not str(label).strip():
                    continue
                tag_id = register_tag(db, q["subject"], q["stage"], kind, str(label), q.get("tags_source", "source"))
                tags.append({"id": tag_id, "kind": kind, "label": str(label), "origin": q.get("tags_source", "source")})
        for label in q.get("derived_type_tags", []):
            tag_id = register_tag(db, q["subject"], q["stage"], "type", label, "source_derived")
            tags.append({"id": tag_id, "kind": "type", "label": label, "origin": "source_derived"})
        q["tags"] = tags
        db.execute("INSERT INTO bank_questions VALUES(?,?,?,?,?,?,?,?,?,?)",
                   (q["id"], dataset, q["subject"], q["stage"], q["kind"], q["status"], q["difficulty"], digest, dumps(q), now()))
        db.executemany("INSERT OR IGNORE INTO bank_question_tags VALUES(?,?)", [(q["id"], tag["id"]) for tag in tags])
        counts["inserted"] += 1
        inserted_ids.append(q["id"])
        counts[q["status"]] += 1
    from app.courses import sync_questions
    sync_questions(db, inserted_ids)
    audit(db, "bank_import", {"dataset": dataset, **counts, "manifest": manifest})
    return counts


def public(q, reveal=False):
    fields = ("id", "subject", "stage", "grade", "term", "stem", "options", "kind", "answer_mode", "difficulty",
              "difficulty_raw", "tags", "tags_source", "status", "issues", "provenance", "can_practice", "has_missing_assets")
    result = {k: q.get(k) for k in fields}
    if reveal:
        result.update(answer=q["answer"], steps=q["steps"])
    return result


def catalog(db):
    if scope():
        where,args=clauses(Selection())
        rows=[dict(r) for r in db.execute("SELECT q.subject,q.stage,q.status,COUNT(*) count,SUM(json_extract(q.data,'$.can_practice')) playable FROM bank_questions q WHERE "+where+" GROUP BY q.subject,q.stage,q.status",args)]
        return {"subjects":[{"id":"math","name":"数学"}],"stages":{"junior":"初中"},"counts":rows,"sources":[]}
    rows = [dict(r) for r in db.execute("SELECT subject,stage,status,COUNT(*) count,SUM(json_extract(data,'$.can_practice')) playable FROM bank_questions WHERE status!='superseded' GROUP BY subject,stage,status")]
    return {"subjects": [{"id": key, "name": label} for key, label in SUBJECTS.items()], "stages": STAGES,
            "counts": rows, "sources": [{"id": r["id"], "manifest": json.loads(r["manifest"]), "imported_at": r["imported_at"]} for r in db.execute("SELECT * FROM bank_sources")],
            "note": "初中题集覆盖多个年级；未标年级/学期的题不会自动视为七上。来源答案尚未逐题教师审定。"}


def clauses(selection, playable=False):
    if scope():
        if selection.subject != "math" or selection.stage != "junior" or (selection.course_book_id and selection.course_book_id != book_id()):
            raise HTTPException(403,"题库只开放当前学习阶段")
        selection = selection.model_copy(update={"course_book_id":book_id()})
    if selection.subject not in SUBJECTS or selection.stage not in STAGES:
        raise HTTPException(422, "请选择已有学科与学段")
    where = ["q.subject=?", "q.stage=?", "q.status NOT IN ('quarantine','superseded')"]
    args = [selection.subject, selection.stage]
    if scope():
        where += ["(json_extract(q.data,'$.grade') IS NULL OR json_extract(q.data,'$.grade')=?)", "(json_extract(q.data,'$.term') IS NULL OR json_extract(q.data,'$.term')=?)"]
        args += [scope()["grade"],scope()["term"]]
    from app.courses import validate_scope, scope_goals, VERSION as COURSE_VERSION
    validate_scope(selection.subject, selection.course_book_id, selection.course_unit_id)
    if selection.course_book_id:
        if selection.stage != "junior":
            raise HTTPException(422, "当前课程目标仅覆盖初中")
        ids = [g["id"] for g in scope_goals(selection.course_book_id, selection.course_unit_id)]
        where.append("EXISTS (SELECT 1 FROM course_question_links cl WHERE cl.question_id=q.id AND cl.version=? AND cl.goal_id IN (" + ",".join("?" for _ in ids) + "))")
        args += [COURSE_VERSION, *ids]
    if playable:
        where.append("json_extract(q.data,'$.can_practice')=1")
    if selection.tag_id:
        where.append("EXISTS (SELECT 1 FROM bank_question_tags t WHERE t.question_id=q.id AND t.tag_id=?)")
        args.append(selection.tag_id)
    if selection.difficulty:
        where.append("q.difficulty=?")
        args.append(selection.difficulty)
    if selection.answer_mode:
        if selection.answer_mode not in {"choice", "written"}:
            raise HTTPException(422, "作答方式无效")
        where.append("json_extract(q.data,'$.answer_mode')=?")
        args.append(selection.answer_mode)
    if selection.source_id:
        where.append("q.source_id=?")
        args.append(selection.source_id)
    if selection.question_id:
        where.append("q.id=?")
        args.append(selection.question_id)
    return " AND ".join(where), args


def search(db, selection, query="", limit=20, offset=0):
    where, args = clauses(selection)
    if query:
        where += " AND (json_extract(q.data,'$.stem') LIKE ? OR EXISTS(SELECT 1 FROM bank_question_tags qt JOIN bank_taxonomy t ON t.id=qt.tag_id WHERE qt.question_id=q.id AND t.label LIKE ?))"
        args += ["%" + query + "%"] * 2
    total = db.execute("SELECT COUNT(*) FROM bank_questions q WHERE " + where, args).fetchone()[0]
    rows = db.execute("SELECT q.data FROM bank_questions q WHERE " + where + " ORDER BY q.id LIMIT ? OFFSET ?", [*args, limit, offset])
    return {"total": total, "items": [public(json.loads(r[0])) for r in rows]}


def tags(db, subject, stage, query="", limit=100):
    where,args = clauses(Selection(subject=subject, stage=stage))
    rows = db.execute("SELECT t.*,COUNT(*) question_count FROM bank_taxonomy t JOIN bank_question_tags qt ON qt.tag_id=t.id JOIN bank_questions q ON q.id=qt.question_id WHERE "+where+" AND t.label LIKE ? GROUP BY t.id ORDER BY question_count DESC,t.label LIMIT ?",[*args,'%'+query+'%',limit])
    return {"items":[dict(r) for r in rows]}


def get_attempt(db, attempt_id):
    row = db.execute("SELECT a.*,q.data FROM bank_attempts a JOIN bank_questions q ON q.id=a.question_id WHERE a.id=? AND student_id=current_student()", (attempt_id,)).fetchone()
    if not row:
        raise HTTPException(404, "题库作答不存在")
    if scope():
        where,args=clauses(Selection())
        if not db.execute("SELECT 1 FROM bank_questions q WHERE q.id=? AND "+where,[row["question_id"],*args]).fetchone():
            raise HTTPException(403,"该题不在当前学习阶段")
    return row, json.loads(row["data"])


def next_question(db, selection):
    db.execute("BEGIN IMMEDIATE")
    where, args = clauses(selection, playable=True)
    active = db.execute("SELECT id,question_id FROM bank_attempts WHERE student_id=current_student() AND status='assigned'").fetchone()
    if active and db.execute("SELECT 1 FROM bank_questions q WHERE q.id=? AND " + where, [active["question_id"], *args]).fetchone():
        row, q = get_attempt(db, active["id"])
        review = db.execute("SELECT data FROM bank_reviews WHERE attempt_id=?", (row["id"],)).fetchone()
        return {"attempt_id": row["id"], "question": public(q), "review": json.loads(review[0]) if review else None, "resumed": True}
    # 先查可用题，空筛选不跳过学生当前作答。按最少作答次数随机。
    candidates = list(db.execute("""SELECT q.id,q.data,(SELECT COUNT(*) FROM bank_attempts a WHERE a.question_id=q.id AND a.student_id=current_student()) n
        FROM bank_questions q WHERE """ + where + " ORDER BY n,RANDOM() LIMIT 1000", args))
    if not candidates:
        raise HTTPException(404, "当前筛选没有可练习题；缺图或缺参考答案的材料仅供查阅")
    if not selection.difficulty:
        challenge = selection.allow_challenge and random.random() < .15
        scoped = [r for r in candidates if (json.loads(r["data"])["difficulty"] == 3) == challenge]
        candidates = scoped or candidates
    # 优先学生证据中薄弱的精细标签，避免只按学科粗分类。
    weak = db.execute("""SELECT qt.tag_id FROM bank_attempts a JOIN bank_question_tags qt ON qt.question_id=a.question_id
        JOIN bank_questions q ON q.id=a.question_id WHERE a.student_id=current_student() AND a.status='submitted'
        AND q.subject=? AND q.stage=? AND json_extract(a.result,'$.evidence_weight')>0
        AND json_extract(a.result,'$.correct')=0 ORDER BY a.submitted_at DESC LIMIT 30""", (selection.subject, selection.stage)).fetchall()
    weak_ids = {r[0] for r in weak}
    if weak_ids and not selection.tag_id:
        targeted = [r for r in candidates if any(t["id"] in weak_ids for t in json.loads(r["data"])["tags"] if t["kind"] == "knowledge")]
        candidates = targeted or candidates
    least = min(r["n"] for r in candidates)
    selected = random.choice([r for r in candidates if r["n"] == least])
    if active:
        db.execute("UPDATE bank_attempts SET status='skipped' WHERE id=?", (active["id"],))
    attempt_id = str(uuid.uuid4())
    db.execute("INSERT INTO bank_attempts(id,student_id,question_id,status,created_at) VALUES(?,current_student(),?,'assigned',?)", (attempt_id, selected["id"], now()))
    return {"attempt_id": attempt_id, "question": public(json.loads(selected["data"])), "review": None, "resumed": False}


def canonical_choice(value, q):
    text = unicodedata.normalize("NFKC", value).upper().strip()
    if not re.fullmatch(r"[A-Z\s,，、;；]+", text):
        raise HTTPException(422, "请选择选项字母")
    answer = "".join(sorted(set(re.findall("[A-Z]", text))))
    keys = {item["key"] for item in q["options"]}
    if not answer or set(answer) - keys or (q["kind"] == "single_choice" and len(answer) != 1):
        raise HTTPException(422, "所选选项与题型不匹配")
    return answer


def finish(db, row, q, answer, verdict, base_weight, explanation=None):
    if row["status"] != "assigned":
        raise HTTPException(409, "这道作答已完成或已切换")
    repeated = db.execute("SELECT 1 FROM bank_attempts WHERE student_id=current_student() AND question_id=? AND status='submitted' AND json_extract(result,'$.evidence_weight')>0", (q["id"],)).fetchone()
    weight = 0 if repeated or verdict not in {"correct", "incorrect"} else base_weight * (.35 if row["assisted"] and verdict == "correct" else 1)
    result = {"correct": verdict == "correct", "verdict": verdict, "answer": q["answer"], "steps": q["steps"],
              "evidence_weight": weight, "assisted": bool(row["assisted"]), "repeated": bool(repeated), "explanation": explanation,
              "assessment_source": "source_answer" if base_weight == 1 else "ai_review_confirmed"}
    db.execute("UPDATE bank_attempts SET status='submitted',answer=?,result=?,submitted_at=? WHERE id=?", (answer, dumps(result), now(), row["id"]))
    audit(db, "bank_answer", {"attempt_id": row["id"], "subject": q["subject"], "verdict": verdict, "weight": weight})
    return result


def answer_choice(db, attempt_id, value):
    db.execute("BEGIN IMMEDIATE")
    row, q = get_attempt(db, attempt_id)
    if q["answer_mode"] != "choice":
        raise HTTPException(422, "本题需要文字或拍照作答")
    answer = canonical_choice(value, q)
    if row["status"] == "submitted":
        if row["answer"] == answer:
            return json.loads(row["result"])
        raise HTTPException(409, "已提交，不能修改评分")
    expected = canonical_choice(q["answer"], q)
    return finish(db, row, q, answer, "correct" if answer == expected else "incorrect", 1)


def profile(db, subject="math", stage="junior"):
    clauses(Selection(subject=subject, stage=stage))
    rows = list(db.execute("""SELECT a.*,q.data FROM bank_attempts a JOIN bank_questions q ON a.question_id=q.id
        WHERE a.student_id=current_student() AND q.subject=? AND q.stage=? AND a.status='submitted' ORDER BY a.submitted_at DESC""", (subject, stage)))
    states = {}
    history = []
    for row in rows:
        q, result = json.loads(row["data"]), json.loads(row["result"])
        if len(history) < 30:
            history.append({"attempt_id": row["id"], "question": public(q), "answer": row["answer"], "result": result, "submitted_at": row["submitted_at"]})
        weight = result["evidence_weight"]
        if not weight:
            continue
        for tag in q["tags"]:
            state = states.setdefault(tag["id"], {**tag, "attempts": 0, "correct": 0, "success": 0., "failure": 0.})
            state["attempts"] += 1
            state["correct"] += int(result["correct"])
            state["success" if result["correct"] else "failure"] += weight
    for state in states.values():
        probability = (1 + state["success"]) / (2 + state["success"] + state["failure"])
        state["mastery"] = round(probability, 3)
        state["status"] = "证据不足" if state["attempts"] < 3 else "需要巩固" if probability < .6 else "掌握较稳" if probability >= .8 else "正在进步"
        del state["success"], state["failure"]
    for row in db.execute("SELECT * FROM bank_taxonomy WHERE subject=? AND stage=? AND origin='ai'",(subject,stage)):
        states.setdefault(row["id"],{"id":row["id"],"label":row["label"],"kind":row["kind"],"origin":"ai","attempts":0,"correct":0,"mastery":None,"status":"尚未诊断"})
    return {"subject": subject, "stage": stage, "completed": len(rows), "correct": sum(json.loads(r["result"])["correct"] for r in rows),
            "tags": sorted(states.values(), key=lambda t: (t["mastery"] is None,t["mastery"] or 0, t["label"])), "history": history,
            "note": "按来源知识点与题型分别累计证据；人工核对后的主观题权重0.5，部分正确/不确定不计掌握证据。"}
