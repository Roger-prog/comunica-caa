PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('responsavel','fonoaudiologo'))
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS children (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
 child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(child_id,user_id)
);
CREATE TABLE IF NOT EXISTS words (
 id INTEGER PRIMARY KEY, child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 label TEXT NOT NULL, symbol TEXT NOT NULL, category TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), UNIQUE(child_id,label)
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY, child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 word_id INTEGER NOT NULL REFERENCES words(id), user_id INTEGER NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('use','evolution')),
 stage INTEGER NOT NULL CHECK(stage BETWEEN 0 AND 3), note TEXT NOT NULL DEFAULT '',
 word_label TEXT NOT NULL, created_at TEXT NOT NULL, request_id TEXT NOT NULL,
 UNIQUE(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_events_child_date ON events(child_id,created_at);
CREATE INDEX IF NOT EXISTS idx_events_word ON events(word_id,id);
PRAGMA user_version = 1;
