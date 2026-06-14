import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Ensure the directory containing the SQLite file exists.
const dir = path.dirname(config.dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT,
  google_id     TEXT UNIQUE,   -- legacy, kept for one-time backfill into oidc_iss/oidc_sub
  oidc_iss      TEXT,          -- OIDC issuer URL (e.g. https://accounts.google.com)
  oidc_sub      TEXT,          -- OIDC subject claim
  role          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  status        TEXT NOT NULL DEFAULT 'pending',-- 'pending' | 'active' | 'disabled'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_id);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_user_folder ON notes(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);

-- Personal access tokens (API keys) for programmatic access. The token
-- itself is shown to the user once at creation; only its SHA-256 hash
-- is stored. The prefix column is a short non-secret slice for UI
-- identification.
CREATE TABLE IF NOT EXISTS api_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  prefix        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  expires_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

-- Full-text search over note title and content.
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, content, content='notes', content_rowid='id'
);

-- Triggers keep the FTS index in sync.
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
`;

db.exec(SCHEMA);

// --- Migrations for existing databases ---------------------------------
// Add the OIDC columns to pre-OIDC users tables. Idempotent: ALTER TABLE
// throws on duplicate column, which we ignore.
try { db.exec('ALTER TABLE users ADD COLUMN oidc_iss TEXT'); } catch (e) { /* already there */ }
try { db.exec('ALTER TABLE users ADD COLUMN oidc_sub TEXT'); } catch (e) { /* already there */ }

// One-time backfill: any user with google_id gets migrated to
// (oidc_iss='https://accounts.google.com', oidc_sub=google_id).
// Idempotent and safe: only acts on rows that don't yet have an OIDC link.
db.exec(`
  UPDATE users
  SET oidc_iss = 'https://accounts.google.com', oidc_sub = google_id
  WHERE google_id IS NOT NULL AND oidc_sub IS NULL
`);

// One OIDC identity per (iss, sub). Partial index — only enforced for rows
// that have an OIDC link; pure password users are unaffected.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc ON users(oidc_iss, oidc_sub) WHERE oidc_iss IS NOT NULL`);

// One-time index warmup is implicit on first INSERT/UPDATE.
