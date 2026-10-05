const path = require("path");
const Database = require("better-sqlite3");

// DB_PATH lets you point the database at a mounted persistent disk (e.g. on
// Render: /data/data.db). Defaults to the project folder for local use.
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    participant_id TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    completion_code TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`);

function createSession(id, participantId) {
  db.prepare(
    "INSERT INTO sessions (id, participant_id, started_at) VALUES (?, ?, ?)"
  ).run(id, participantId || null, new Date().toISOString());
  return getSession(id);
}

function getSession(id) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
}

function finishSession(id, code) {
  db.prepare(
    "UPDATE sessions SET finished_at = ?, completion_code = ? WHERE id = ?"
  ).run(new Date().toISOString(), code, id);
  return getSession(id);
}

function addMessage(sessionId, role, content) {
  db.prepare(
    "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, role, content, new Date().toISOString());
}

function getMessages(sessionId) {
  return db
    .prepare(
      "SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC"
    )
    .all(sessionId);
}

function clearAllData() {
  db.prepare("DELETE FROM messages").run();
  db.prepare("DELETE FROM sessions").run();
}

function getAllRowsForExport() {
  return db
    .prepare(
      `SELECT
        s.id AS session_id,
        s.participant_id AS participant_id,
        s.started_at AS started_at,
        s.finished_at AS finished_at,
        s.completion_code AS completion_code,
        m.id AS message_index,
        m.role AS role,
        m.content AS content,
        m.created_at AS message_created_at
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      ORDER BY s.started_at ASC, m.id ASC`
    )
    .all();
}

module.exports = {
  createSession,
  getSession,
  finishSession,
  addMessage,
  getMessages,
  clearAllData,
  getAllRowsForExport,
};
