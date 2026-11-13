import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// The assistant keeps its own small SQLite file. The website's MongoDB is never opened or written.
// node:sqlite is synchronous, so every method below is atomic with respect to the event loop.
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS gemini_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL, day TEXT NOT NULL, user_id TEXT NOT NULL, priority TEXT NOT NULL, outcome TEXT
    );
    CREATE INDEX IF NOT EXISTS gemini_calls_at ON gemini_calls(at);
    CREATE INDEX IF NOT EXISTS gemini_calls_day ON gemini_calls(day, user_id);
    CREATE TABLE IF NOT EXISTS gemini_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, params TEXT NOT NULL, param_hash TEXT NOT NULL,
      preview TEXT NOT NULL, status TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', result TEXT,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY, audience TEXT NOT NULL, message TEXT NOT NULL, created_by TEXT NOT NULL, created_by_name TEXT,
      created_at INTEGER NOT NULL, proposal_id TEXT UNIQUE, eligible INTEGER
    );
    CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at INTEGER NOT NULL, PRIMARY KEY (announcement_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_id TEXT, user_name TEXT, action TEXT NOT NULL,
      target TEXT, detail TEXT
    );
    CREATE TABLE IF NOT EXISTS replies (
      user_id TEXT NOT NULL, message_id TEXT NOT NULL, reply TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, message_id)
    );
  `);

  const q = (sql) => db.prepare(sql);
  const stmts = {
    insertCall: q('INSERT INTO gemini_calls (at, day, user_id, priority, outcome) VALUES (?, ?, ?, ?, ?)'),
    setOutcome: q('UPDATE gemini_calls SET outcome = ? WHERE id = ?'),
    countMinute: q('SELECT COUNT(*) AS n, MIN(at) AS oldest FROM gemini_calls WHERE at > ?'),
    countDay: q('SELECT COUNT(*) AS n FROM gemini_calls WHERE day = ?'),
    countDayUser: q('SELECT COUNT(*) AS n, MAX(at) AS last FROM gemini_calls WHERE day = ? AND user_id = ?'),
    lastUserCall: q('SELECT MAX(at) AS last FROM gemini_calls WHERE user_id = ?'),
    getState: q('SELECT value FROM gemini_state WHERE key = ?'),
    putState: q('INSERT INTO gemini_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    insertProposal: q('INSERT INTO proposals (id, user_id, kind, params, param_hash, preview, status, created_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    getProposal: q('SELECT * FROM proposals WHERE id = ?'),
    // Expiry of a pending proposal is checked by the caller. A partly applied proposal, or one whose
    // executor stopped responding (stale 'executing'), may always be resumed. Atomic: one winner.
    claimProposal: q("UPDATE proposals SET status = 'executing', updated_at = ? WHERE id = ? AND user_id = ? AND (status IN ('pending', 'partial') OR (status = 'executing' AND updated_at < ?))"),
    saveProposal: q('UPDATE proposals SET status = ?, steps = ?, result = ?, updated_at = ? WHERE id = ?'),
    cancelProposal: q("UPDATE proposals SET status = 'cancelled', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'"),
    supersede: q("UPDATE proposals SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND status = 'pending'"),
    insertAnnouncement: q('INSERT INTO announcements (id, audience, message, created_by, created_by_name, created_at, proposal_id, eligible) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    listAnnouncements: q('SELECT * FROM announcements ORDER BY created_at DESC LIMIT ?'),
    getAnnouncementByProposal: q('SELECT * FROM announcements WHERE proposal_id = ?'),
    markRead: q('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)'),
    readsFor: q('SELECT announcement_id FROM announcement_reads WHERE user_id = ?'),
    readCount: q('SELECT COUNT(*) AS n FROM announcement_reads WHERE announcement_id = ?'),
    insertAudit: q('INSERT INTO audit (at, user_id, user_name, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)'),
    listAudit: q('SELECT * FROM audit ORDER BY id DESC LIMIT ?'),
    getReply: q('SELECT reply FROM replies WHERE user_id = ? AND message_id = ?'),
    putReply: q('INSERT OR REPLACE INTO replies (user_id, message_id, reply, at) VALUES (?, ?, ?, ?)'),
    pruneReplies: q('DELETE FROM replies WHERE at < ?'),
  };

  return {
    db,
    close: () => db.close(),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    stmts,
  };
}
