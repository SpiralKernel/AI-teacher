import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import ROOT, Settings
from app.curriculum import NODES, UNITS, VERSION
from app.db import audit, connect, dumps, initialize, now
from app.learning import get_attempt, history, next_question, profile, recommend, submit
from app.tutor import respond


class PracticeRequest(BaseModel):
    knowledge_id: str | None = Field(default=None, max_length=50)


class AnswerRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=64)


class TutorRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1200)


def create_app(settings: Settings | None = None):
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        initialize(settings.database_path)
        yield

    app = FastAPI(title="AI-teacher · 七年级数学", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    tutor_slots = asyncio.Semaphore(1)

    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/v1/health")
    def health():
        with connect(settings.database_path) as db:
            count = db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        return {"status": "ok", "ai_configured": bool(settings.deepseek_api_key),
                "model": settings.deepseek_model, "question_count": count,
                "curriculum_version": VERSION, "mode": "local_single_student"}

    @app.get("/api/v1/curriculum")
    def curriculum():
        return {"version": VERSION, "grade": 7, "term": 1, "units": UNITS, "knowledge": NODES,
                "note": "项目自编七年级上册起步范围；非完整教材，章节顺序可按教材版本调整。"}

    @app.get("/api/v1/student")
    def student():
        with connect(settings.database_path) as db:
            result = profile(db)
            knowledge_id, reason = recommend(db)
        return {**result, "recommendation": {"knowledge_id": knowledge_id, "reason": reason}}

    @app.post("/api/v1/practice/next")
    def practice(body: PracticeRequest):
        with connect(settings.database_path) as db:
            return next_question(db, body.knowledge_id)

    @app.post("/api/v1/attempts/{attempt_id}/answer")
    def answer(attempt_id: str, body: AnswerRequest):
        with connect(settings.database_path) as db:
            return submit(db, attempt_id, body.answer)

    @app.post("/api/v1/attempts/{attempt_id}/hint")
    def hint(attempt_id: str):
        with connect(settings.database_path) as db:
            db.execute("BEGIN IMMEDIATE")
            row, q = get_attempt(db, attempt_id)
            if row["status"] != "assigned":
                raise HTTPException(409, "请在作答前使用提示")
            db.execute("UPDATE attempts SET hint_used=1 WHERE id=?", (attempt_id,))
            return {"hint": q["hint"], "assisted": True}

    @app.post("/api/v1/attempts/{attempt_id}/tutor")
    async def tutor(attempt_id: str, body: TutorRequest):
        if not body.message.strip():
            raise HTTPException(422, "请输入想讨论的问题")
        async with tutor_slots:
            with connect(settings.database_path) as db:
                db.execute("BEGIN IMMEDIATE")
                row, q = get_attempt(db, attempt_id)
                if row["status"] == "skipped":
                    raise HTTPException(409, "这道练习已经跳过")
                previous = list(db.execute("SELECT user_message,response FROM tutor_messages WHERE attempt_id=? ORDER BY id", (attempt_id,)))
                if len(previous) >= 12:
                    raise HTTPException(429, "这道题已讨论 12 轮，建议休息一下或开始下一题")
                if row["status"] == "assigned":
                    db.execute("UPDATE attempts SET hint_used=1 WHERE id=?", (attempt_id,))
                state = next(n for n in profile(db)["knowledge"] if n["id"] == q["knowledge_id"])
                summary = {k: state[k] for k in ("attempts", "mastery", "status")}
            result = await respond(settings, q, body.message, summary, previous, submitted=row["status"] == "submitted")
            with connect(settings.database_path) as db:
                db.execute("INSERT INTO tutor_messages(attempt_id,user_message,response,created_at) VALUES(?,?,?,?)",
                           (attempt_id, body.message, dumps(result), now()))
                audit(db, "tutor_response", {"attempt_id": attempt_id, "provider": result["provider"]})
            return result

    @app.get("/api/v1/history")
    def attempts():
        with connect(settings.database_path) as db:
            return {"items": history(db)}

    app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(ROOT / "web/index.html")

    return app


app = create_app()
