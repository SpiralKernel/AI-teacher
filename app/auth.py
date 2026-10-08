"""本地账号与不透明会话；首次注册原子认领旧 demo 数据。"""
import hashlib
import hmac
import re
import secrets
import time
import unicodedata
import uuid

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.db import connect, now
from app.identity import scope, student_id

COOKIE = 'teacher_session'


class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=8, max_length=128)


class Stage(BaseModel):
    grade: int = Field(ge=7, le=9)
    term: int = Field(ge=1, le=2)


class Registration(Credentials, Stage):
    nickname: str = Field(default='学习者', min_length=1, max_length=30)


def username(value):
    value = unicodedata.normalize('NFKC', value).strip().casefold()
    if not re.fullmatch(r'[\w.-]{2,40}', value):
        raise HTTPException(422, '用户名使用 2—40 个汉字、字母、数字、点或下划线')
    return value


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def identity(db, token):
    if not token or len(token) > 200:
        return None
    row = db.execute('''SELECT s.student_id,p.grade,p.term,a.username,t.nickname FROM auth_sessions s
        JOIN student_scopes p ON p.student_id=s.student_id JOIN accounts a ON a.student_id=s.student_id
        JOIN students t ON t.id=s.student_id WHERE s.token_hash=? AND s.expires>?''', (digest(token), time.time())).fetchone()
    return dict(row) if row else None


def session(db, owner, response, request):
    token = secrets.token_urlsafe(32)
    db.execute('DELETE FROM auth_sessions WHERE expires<?', (time.time(),))
    db.execute('INSERT INTO auth_sessions VALUES(?,?,?)', (digest(token), owner, time.time()+7*86400))
    response.set_cookie(COOKIE, token, max_age=7*86400, httponly=True, samesite='strict', secure=request.url.scheme=='https', path='/')


def create_router(settings):
    router = APIRouter(prefix='/api/v1/auth', tags=['学生账号'])

    @router.get('/session')
    def status():
        with connect(settings.database_path) as db:
            needs_setup = db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 0
        return {'authenticated': bool(scope()), 'student': scope(), 'needs_setup': needs_setup}

    @router.post('/register', status_code=201)
    def register(body: Registration, request: Request, response: Response):
        name = username(body.username)
        salt = secrets.token_hex(16)
        hashed = password_hash(body.password, salt)
        with connect(settings.database_path) as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM accounts WHERE username=?', (name,)).fetchone():
                raise HTTPException(409, '该用户名已存在')
            first = db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 0
            owner = 'demo' if first else str(uuid.uuid4())
            if first:
                db.execute('UPDATE students SET nickname=? WHERE id=?', (body.nickname.strip() or '学习者', owner))
            else:
                db.execute('INSERT INTO students VALUES(?,?,?)', (owner, body.nickname.strip() or '学习者', now()))
            db.execute('INSERT INTO accounts VALUES(?,?,?,?,?)', (name, owner, salt, hashed, now()))
            db.execute('INSERT INTO student_scopes VALUES(?,?,?)', (owner, body.grade, body.term))
            session(db, owner, response, request)
        return {'authenticated': True, 'inherited_records': first}

    @router.post('/login')
    def login(body: Credentials, request: Request, response: Response):
        name = username(body.username)
        with connect(settings.database_path) as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM login_failures WHERE created<?', (time.time()-900,))
            if db.execute('SELECT COUNT(*) FROM login_failures WHERE username=?', (name,)).fetchone()[0] >= 10:
                raise HTTPException(429, '尝试次数较多，请 15 分钟后再试')
            row = db.execute('SELECT * FROM accounts WHERE username=?', (name,)).fetchone()
            hashed = password_hash(body.password, row['salt'] if row else '00'*16)
            valid = bool(row and hmac.compare_digest(hashed, row['password_hash']))
            if valid:
                db.execute('DELETE FROM login_failures WHERE username=?', (name,))
                session(db, row['student_id'], response, request)
            else:
                db.execute('INSERT INTO login_failures VALUES(?,?)', (name, time.time()))
        if not valid:
            raise HTTPException(401, '用户名或密码不正确')
        return {'authenticated': True}

    @router.post('/logout')
    def logout(request: Request, response: Response):
        with connect(settings.database_path) as db:
            db.execute('DELETE FROM auth_sessions WHERE token_hash=?', (digest(request.cookies.get(COOKIE,'')),))
        response.delete_cookie(COOKIE, path='/')
        return {'authenticated': False}

    @router.post('/stage')
    def stage(body: Stage):
        with connect(settings.database_path) as db:
            db.execute('UPDATE student_scopes SET grade=?,term=? WHERE student_id=?', (body.grade,body.term,student_id()))
            # 保留旧记录，只重置当前选择范围。
            db.execute('DELETE FROM course_settings WHERE student_id=?', (student_id(),))
            db.execute('DELETE FROM student_preferences WHERE student_id=?', (student_id(),))
        return {'grade': body.grade, 'term': body.term}

    return router
