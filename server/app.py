"""Comunica API. Run: python -m uvicorn app:app --host 0.0.0.0 --port 8000."""
import csv
import hashlib
import hmac
import io
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

DB_PATH = Path(os.environ.get('COMUNICA_DB', str(Path(__file__).parent / 'data' / 'comunica.sqlite3')))
app = FastAPI(title='Comunica • CAA', version='1.0.0')
if os.environ.get('COMUNICA_DEV_ORIGIN'):
    app.add_middleware(CORSMiddleware, allow_origins=[os.environ['COMUNICA_DEV_ORIGIN']], allow_methods=['GET', 'POST', 'PUT', 'DELETE'], allow_headers=['Content-Type', 'Authorization'])


@contextmanager
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript(Path(__file__).with_name('schema.sql').read_text(encoding='utf-8'))


init_db()


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000).hex()
    return salt + ':' + hashed


def session(conn, user):
    token = secrets.token_urlsafe(48)
    conn.execute('DELETE FROM sessions WHERE expires_at < ?', (int(time.time()),))
    conn.execute('INSERT INTO sessions VALUES (?,?,?)', (digest(token), user['id'], int(time.time()) + 604800))
    return {'token': token, 'user': {k: user[k] for k in ('id', 'name', 'email', 'role')}}


def current_user(authorization: str = Header(default='')):
    token = authorization.removeprefix('Bearer ')
    with db() as conn:
        user = conn.execute('SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?', (digest(token), int(time.time()))).fetchone()
    if not authorization.startswith('Bearer ') or not user:
        raise HTTPException(401, 'Entre novamente para continuar.')
    return dict(user)


def access(conn, child_id, user, owner=False):
    child = conn.execute('SELECT * FROM children WHERE id=?', (child_id,)).fetchone()
    if not child:
        raise HTTPException(404, 'Perfil não encontrado.')
    if child['owner_id'] != user['id']:
        if owner or not conn.execute('SELECT 1 FROM members WHERE child_id=? AND user_id=?', (child_id, user['id'])).fetchone():
            raise HTTPException(403, 'Você não tem acesso a este perfil.')
    return child


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)

    @field_validator('email')
    @classmethod
    def email_valid(cls, v):
        v = v.strip().lower()
        if v.count('@') != 1 or '.' not in v.split('@')[-1] or any(c.isspace() for c in v):
            raise ValueError('E-mail inválido')
        return v


class Register(Credentials):
    name: str = Field(min_length=1, max_length=80)
    role: Literal['responsavel', 'fonoaudiologo']

    @field_validator('name')
    @classmethod
    def name_valid(cls, v):
        if not v.strip():
            raise ValueError('Informe o nome')
        return v.strip()


class ChildInput(Input):
    name: str = Field(min_length=1, max_length=80)


class WordInput(Input):
    label: str = Field(min_length=1, max_length=60)
    symbol: str = Field(min_length=1, max_length=12)
    category: str = Field(min_length=1, max_length=40)
    active: bool = True


class EventInput(Input):
    word_id: int
    kind: Literal['use', 'evolution']
    stage: int = Field(ge=0, le=3)
    note: str = Field(default='', max_length=1000)
    request_id: str = Field(min_length=16, max_length=100)


class MemberInput(Input):
    email: str = Field(min_length=3, max_length=254)


@app.get('/health')
def health():
    return {'status': 'ok'}


@app.post('/auth/register', status_code=201)
def register(body: Register):
    hashed = password_hash(body.password)
    with db() as conn:
        try:
            uid = conn.execute('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)', (body.name, body.email, hashed, body.role)).lastrowid
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'E-mail já cadastrado.')
        return session(conn, {'id': uid, **body.model_dump()})


@app.post('/auth/login')
def login(body: Credentials):
    with db() as conn:
        user = conn.execute('SELECT * FROM users WHERE email=?', (body.email,)).fetchone()
        salt = user['password_hash'].split(':')[0] if user else '00' * 16
        candidate = password_hash(body.password, salt)
        if not user or not hmac.compare_digest(candidate, user['password_hash']):
            raise HTTPException(401, 'E-mail ou senha incorretos.')
        return session(conn, user)


@app.get('/auth/me')
def me(user=Depends(current_user)):
    return user


@app.post('/auth/logout', status_code=204)
def logout(authorization: str = Header(default=''), user=Depends(current_user)):
    with db() as conn:
        conn.execute('DELETE FROM sessions WHERE token_hash=?', (digest(authorization.removeprefix('Bearer ')),))


@app.get('/children')
def children(user=Depends(current_user)):
    with db() as conn:
        return [dict(r) for r in conn.execute('SELECT DISTINCT c.* FROM children c LEFT JOIN members m ON m.child_id=c.id WHERE c.owner_id=? OR m.user_id=? ORDER BY c.name', (user['id'], user['id']))]


SEED = [('Água', '💧', 'Necessidades'), ('Comer', '🍎', 'Necessidades'), ('Banheiro', '🚽', 'Necessidades'), ('Dormir', '🌙', 'Necessidades'), ('Feliz', '😊', 'Sentimentos'), ('Triste', '😢', 'Sentimentos'), ('Dor', '🤕', 'Sentimentos'), ('Abraço', '🤗', 'Sentimentos'), ('Brincar', '🧸', 'Atividades'), ('Passear', '🌳', 'Atividades'), ('Sim', '👍', 'Escolhas'), ('Não', '👎', 'Escolhas'), ('Ajuda', '🙋', 'Necessidades'), ('Mais', '➕', 'Escolhas'), ('Parar', '✋', 'Escolhas'), ('Casa', '🏠', 'Lugares')]


@app.post('/children', status_code=201)
def add_child(body: ChildInput, user=Depends(current_user)):
    if user['role'] != 'responsavel':
        raise HTTPException(403, 'O responsável cadastra a criança e autoriza a equipe.')
    with db() as conn:
        cid = conn.execute('INSERT INTO children(name,owner_id,created_at) VALUES (?,?,?)', (body.name, user['id'], now())).lastrowid
        conn.executemany('INSERT INTO words(child_id,label,symbol,category) VALUES (?,?,?,?)', [(cid, *w) for w in SEED])
        return dict(conn.execute('SELECT * FROM children WHERE id=?', (cid,)).fetchone())


@app.get('/children/{cid}/words')
def words(cid: int, user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user)
        return [dict(r) for r in conn.execute('SELECT * FROM words WHERE child_id=? ORDER BY id', (cid,))]


@app.post('/children/{cid}/words', status_code=201)
def add_word(cid: int, body: WordInput, user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user)
        try:
            wid = conn.execute('INSERT INTO words(child_id,label,symbol,category,active) VALUES (?,?,?,?,?)', (cid, body.label, body.symbol, body.category, body.active)).lastrowid
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Essa palavra já está no vocabulário.')
        return {'id': wid}


@app.put('/children/{cid}/words/{wid}')
def update_word(cid: int, wid: int, body: WordInput, user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user)
        try:
            result = conn.execute('UPDATE words SET label=?,symbol=?,category=?,active=? WHERE child_id=? AND id=?', (body.label, body.symbol, body.category, body.active, cid, wid))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Essa palavra já está no vocabulário.')
        if not result.rowcount:
            raise HTTPException(404, 'Palavra não encontrada.')
        return {'id': wid}


@app.post('/children/{cid}/events', status_code=201)
def event(cid: int, body: EventInput, user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user)
        word = conn.execute('SELECT * FROM words WHERE child_id=? AND id=?', (cid, body.word_id)).fetchone()
        if not word:
            raise HTTPException(404, 'Palavra não encontrada neste perfil.')
        if body.kind == 'use' and body.stage != 0:
            raise HTTPException(422, 'Uso da prancha não confirma vocalização ou domínio.')
        existing = conn.execute('SELECT * FROM events WHERE user_id=? AND request_id=?', (user['id'], body.request_id)).fetchone()
        if existing:
            if existing['child_id'] != cid or any(existing[k] != getattr(body, k) for k in ('word_id', 'kind', 'stage', 'note')):
                raise HTTPException(409, 'Identificador já usado para outro registro.')
            return dict(existing)
        if not word['active']:
            raise HTTPException(409, 'Reative a palavra antes de registrar uma interação.')
        eid = conn.execute('INSERT INTO events(child_id,word_id,user_id,kind,stage,note,word_label,created_at,request_id) VALUES (?,?,?,?,?,?,?,?,?)', (cid, body.word_id, user['id'], body.kind, body.stage, body.note, word['label'], now(), body.request_id)).lastrowid
        return dict(conn.execute('SELECT * FROM events WHERE id=?', (eid,)).fetchone())


def report_data(conn, cid, days):
    start = (datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)).isoformat()
    words = [dict(r) for r in conn.execute('''SELECT w.*,
        (SELECT COUNT(*) FROM events e WHERE e.word_id=w.id AND e.kind='use' AND e.created_at>=?) AS uses,
        (SELECT stage FROM events e WHERE e.word_id=w.id AND e.kind='evolution' ORDER BY e.id DESC LIMIT 1) AS stage
        FROM words w WHERE w.child_id=? ORDER BY uses DESC,w.label''', (start, cid))]
    daily = [dict(r) for r in conn.execute("SELECT substr(created_at,1,10) AS day,COUNT(*) AS count FROM events WHERE child_id=? AND kind='use' AND created_at>=? GROUP BY day ORDER BY day", (cid, start))]
    return {'days': days, 'total_uses': sum(w['uses'] for w in words), 'mastered': sum(w['stage'] == 3 for w in words), 'words': words, 'daily': daily}


@app.get('/children/{cid}/report')
def report(cid: int, days: int = Query(default=7, ge=1, le=365), user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user)
        return report_data(conn, cid, days)


@app.get('/children/{cid}/events')
def history(cid: int, before: int | None = None, user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user)
        return [dict(r) for r in conn.execute('SELECT e.*,u.name AS author FROM events e JOIN users u ON e.user_id=u.id WHERE e.child_id=? AND e.id<? ORDER BY e.id DESC LIMIT 50', (cid, before or 9223372036854775807))]


@app.get('/children/{cid}/report.csv')
def export(cid: int, days: int = Query(default=30, ge=1, le=365), user=Depends(current_user)):
    labels = ['CAA utilizada', 'Tentativa de vocalização', 'Palavra falada', 'Domínio da palavra']
    def cell(value):
        value = str(value)
        return "'" + value if value.lstrip().startswith(('=', '+', '-', '@')) else value
    with db() as conn:
        child = access(conn, cid, user)
        data = report_data(conn, cid, days)
        stream = io.StringIO()
        writer = csv.writer(stream, delimiter=';')
        writer.writerow(['Criança', 'Período (dias)', 'Palavra', 'Categoria', 'Usos no período', 'Última avaliação (todo histórico)', 'Na prancha'])
        for w in data['words']:
            writer.writerow([cell(child['name']), days, cell(w['label']), cell(w['category']), w['uses'], labels[w['stage']] if w['stage'] is not None else 'Sem avaliação', 'Sim' if w['active'] else 'Não'])
        return Response('\ufeff' + stream.getvalue(), media_type='text/csv; charset=utf-8', headers={'Content-Disposition': 'attachment; filename="evolucao.csv"'})


@app.get('/children/{cid}/members')
def members(cid: int, user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user, owner=True)
        return [dict(r) for r in conn.execute('SELECT u.id,u.name,u.email FROM users u JOIN members m ON u.id=m.user_id WHERE m.child_id=?', (cid,))]


@app.post('/children/{cid}/members', status_code=201)
def grant(cid: int, body: MemberInput, user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user, owner=True)
        person = conn.execute("SELECT id FROM users WHERE email=? AND role='fonoaudiologo'", (body.email.strip().lower(),)).fetchone()
        if not person:
            raise HTTPException(404, 'Peça ao profissional para criar uma conta de fonoaudiólogo primeiro.')
        conn.execute('INSERT OR IGNORE INTO members VALUES (?,?)', (cid, person['id']))
        return {'user_id': person['id']}


@app.delete('/children/{cid}/members/{uid}', status_code=204)
def revoke(cid: int, uid: int, user=Depends(current_user)):
    with db() as conn:
        access(conn, cid, user, owner=True)
        conn.execute('DELETE FROM members WHERE child_id=? AND user_id=?', (cid, uid))
