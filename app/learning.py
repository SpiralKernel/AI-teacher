import json
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.curriculum import NODES, NODE_MAP
from app.db import audit, dumps, now, replenish
from app.questions import grade, parse_number, public_question

STUDENT = "demo"


def profile(db) -> dict:
    rows = {r["knowledge_id"]: dict(r) for r in db.execute("SELECT * FROM mastery WHERE student_id=?", (STUDENT,))}
    knowledge = []
    for node in NODES:
        state = rows.get(node["id"], {})
        count = state.get("attempts", 0)
        probability = (1 + state.get("success", 0)) / (2 + state.get("success", 0) + state.get("failure", 0))
        status = "尚未练习" if count == 0 else "证据不足" if count < 3 else "掌握较稳" if probability >= .8 else "需要巩固" if probability < .6 else "正在进步"
        knowledge.append({**node, "attempts": count, "mastery": round(probability, 3) if count else None,
                          "status": status, "last_seen": state.get("last_seen")})
    results = [json.loads(r["result"]) for r in db.execute(
        "SELECT result FROM attempts WHERE student_id=? AND status='submitted'", (STUDENT,))]
    errors = {}
    for r in results:
        if r["error"]:
            e = r["error"]
            errors.setdefault(e["code"], {"code": e["code"], "feedback": e["feedback"], "count": 0})["count"] += 1
    return {"student_id": STUDENT, "nickname": "学习者", "grade": 7, "term": 1,
            "knowledge": knowledge, "completed": len(results),
            "correct": sum(r["correct"] for r in results),
            "weak_patterns": sorted(errors.values(), key=lambda x: -x["count"])[:6],
            "assessment_note": "掌握度是基于答题证据的启发式估计；不足 3 次时不判定掌握。使用提示后的正确答案只计 0.35 权重。"}


def recommend(db):
    states = {n["id"]: n for n in profile(db)["knowledge"]}
    eligible = [n for n in states.values() if all(
        states[p]["attempts"] >= 2 and (states[p]["mastery"] or 0) >= .6 for p in n["prerequisites"])]
    def priority(n):
        # 先做少量诊断，发现薄弱点时回补，间隔较久的点适当提前复习。
        age = 0
        if n["last_seen"]:
            age = min(30, (datetime.now(timezone.utc) - datetime.fromisoformat(n["last_seen"])).days)
        return (n["mastery"] if n["mastery"] is not None else .45) + min(n["attempts"], 8) * .025 - age * .005
    node = min(eligible or list(states.values()), key=priority)
    reason = "先做一道基础诊断，了解你的起点。" if node["attempts"] == 0 else "根据已有答题证据，继续巩固这个知识点。"
    return node["id"], reason


def get_attempt(db, attempt_id: str):
    row = db.execute("SELECT * FROM attempts WHERE id=? AND student_id=?", (attempt_id, STUDENT)).fetchone()
    if not row:
        raise HTTPException(404, "练习记录不存在")
    question = json.loads(db.execute("SELECT data FROM questions WHERE id=?", (row["question_id"],)).fetchone()[0])
    return row, question


def next_question(db, knowledge_id: str | None):
    db.execute("BEGIN IMMEDIATE")
    reason = "你选择了专项练习。"
    if knowledge_id and knowledge_id not in NODE_MAP:
        raise HTTPException(404, "知识点不存在")
    active = db.execute("SELECT * FROM attempts WHERE student_id=? AND status='assigned'", (STUDENT,)).fetchone()
    if active:
        row, q = get_attempt(db, active["id"])
        if knowledge_id is None or q["knowledge_id"] == knowledge_id:
            return {"attempt_id": row["id"], "question": public_question(q), "reason": "继续完成当前练习。", "hint_used": bool(row["hint_used"])}
        db.execute("UPDATE attempts SET status='skipped' WHERE id=?", (row["id"],))
    if not knowledge_id:
        knowledge_id, reason = recommend(db)
    replenish(db)
    candidate = db.execute("""SELECT q.data FROM questions q WHERE q.knowledge_id=? ORDER BY
        (SELECT COUNT(*) FROM attempts a WHERE a.question_id=q.id AND a.student_id=?) ASC,
        q.created_at,q.id LIMIT 1""", (knowledge_id, STUDENT)).fetchone()
    if not candidate:
        raise HTTPException(404, "暂时没有可用题目")
    q = json.loads(candidate[0])
    attempt_id = str(uuid.uuid4())
    db.execute("INSERT INTO attempts(id,student_id,question_id,assigned_at) VALUES(?,?,?,?)",
               (attempt_id, STUDENT, q["id"], now()))
    return {"attempt_id": attempt_id, "question": public_question(q), "reason": reason, "hint_used": False}


def submit(db, attempt_id: str, answer: str):
    db.execute("BEGIN IMMEDIATE")
    row, q = get_attempt(db, attempt_id)
    if row["status"] == "submitted":
        if parse_number(row["answer"]) != parse_number(answer):
            raise HTTPException(409, "这道练习已经提交，请开始下一题")
        return json.loads(row["result"])
    if row["status"] != "assigned":
        raise HTTPException(409, "这道练习已经跳过")
    result = grade(q, answer)
    weight = .35 if row["hint_used"] and result["correct"] else 1.0
    # 同一道题的重复作答保留记录，但不重复增加掌握证据。
    repeated = db.execute("SELECT 1 FROM attempts WHERE student_id=? AND question_id=? AND status='submitted' LIMIT 1",
                          (STUDENT, q["id"])).fetchone() is not None
    result.update(assisted=bool(row["hint_used"]), evidence_weight=0 if repeated else weight,
                  knowledge_id=q["knowledge_id"], repeated_question=repeated)
    db.execute("UPDATE attempts SET status='submitted',answer=?,result=?,submitted_at=? WHERE id=?",
               (answer, dumps(result), now(), attempt_id))
    if not repeated:
        db.execute("""INSERT INTO mastery(student_id,knowledge_id,success,failure,attempts,last_seen) VALUES(?,?,?,?,1,?)
            ON CONFLICT(student_id,knowledge_id) DO UPDATE SET
            success=success+excluded.success,failure=failure+excluded.failure,attempts=attempts+1,last_seen=excluded.last_seen""",
                   (STUDENT, q["knowledge_id"], weight if result["correct"] else 0, 0 if result["correct"] else 1, now()))
    audit(db, "attempt_submitted", {"attempt_id": attempt_id, "correct": result["correct"], "weight": result["evidence_weight"]})
    replenish(db)
    return result


def history(db):
    rows = db.execute("""SELECT a.id,a.answer,a.result,a.submitted_at,q.data FROM attempts a
        JOIN questions q ON a.question_id=q.id WHERE student_id=? AND status='submitted'
        ORDER BY submitted_at DESC LIMIT 50""", (STUDENT,))
    return [{"attempt_id": r["id"], "answer": r["answer"], "result": json.loads(r["result"]),
             "question": public_question(json.loads(r["data"])), "submitted_at": r["submitted_at"]} for r in rows]
