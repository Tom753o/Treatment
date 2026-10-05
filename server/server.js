const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const db = require("./db");

const PORT = process.env.PORT || 8000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com";
const OPENAI_TOKEN = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT =
  process.env.CHAT_SYSTEM_PROMPT ||
  "Du bist ein hilfreicher Assistent im Rahmen einer wissenschaftlichen Studie. Antworte klar, freundlich und auf Deutsch, sofern die Teilnehmerin oder der Teilnehmer nicht in einer anderen Sprache schreibt.";

// Admin key: set ADMIN_KEY as an environment variable (recommended on Render,
// since it survives redeploys without needing a persistent disk). If not set,
// one is generated and stored in a local file next to the database.
const ADMIN_KEY_FILE = process.env.ADMIN_KEY_FILE || path.join(__dirname, "..", "admin_key.txt");
let ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  if (fs.existsSync(ADMIN_KEY_FILE)) {
    ADMIN_KEY = fs.readFileSync(ADMIN_KEY_FILE, "utf8").trim();
  } else {
    ADMIN_KEY = crypto.randomBytes(9).toString("base64url");
    fs.writeFileSync(ADMIN_KEY_FILE, ADMIN_KEY);
  }
}
console.log("Admin export key:", ADMIN_KEY);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function generateCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

app.post("/api/session", (req, res) => {
  const participantId =
    (req.body && req.body.participantId ? String(req.body.participantId) : "").slice(
      0,
      120
    ) || null;
  const id = crypto.randomUUID();
  db.createSession(id, participantId);
  res.status(201).json({ sessionId: id });
});

app.get("/api/session/:id", (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "not_found" });
  const messages = db.getMessages(req.params.id);
  res.json({ session, messages });
});

app.post("/api/session/:id/message", async (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.finished_at) return res.status(400).json({ error: "session_finished" });

  const content = (req.body && req.body.content ? String(req.body.content) : "").trim();
  if (!content) return res.status(400).json({ error: "empty_message" });
  if (content.length > 4000) return res.status(400).json({ error: "message_too_long" });

  if (!OPENAI_URL || !OPENAI_TOKEN) {
    return res.status(500).json({ error: "openai_not_configured" });
  }

  db.addMessage(session.id, "user", content);

  const history = db.getMessages(session.id).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const openaiRes = await fetch(`${OPENAI_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_TOKEN}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        temperature: 0.7,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI error", openaiRes.status, errText);
      return res.status(502).json({ error: "openai_error" });
    }

    const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) return res.status(502).json({ error: "openai_empty_reply" });

    db.addMessage(session.id, "assistant", reply);
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI request failed", err);
    res.status(502).json({ error: "openai_request_failed" });
  }
});

app.post("/api/session/:id/finish", (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.finished_at) {
    return res.json({ code: session.completion_code });
  }
  const code = generateCode();
  db.finishSession(session.id, code);
  res.json({ code });
});

app.post("/api/admin/reset", (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).send("Forbidden");
  }
  db.clearAllData();
  res.json({ ok: true });
});

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  let str = String(value);
  // Neutralize CSV formula injection: if a field starts with a character
  // that spreadsheet apps interpret as a formula trigger, prefix it with
  // a single quote so it's treated as plain text on open.
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

app.get("/api/export", (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).send("Forbidden");
  }
  const rows = db.getAllRowsForExport();
  const header = [
    "session_id",
    "participant_id",
    "started_at",
    "finished_at",
    "completion_code",
    "message_index",
    "role",
    "content",
    "message_created_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      header.map((h) => csvEscape(r[h])).join(",")
    );
  }
  const csv = lines.join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="chat_export_${Date.now()}.csv"`
  );
  res.send(csv);
});

app.get("/api/admin/check", (req, res) => {
  res.json({ ok: req.query.key === ADMIN_KEY });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
