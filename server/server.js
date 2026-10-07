const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const db = require("./db");

const PORT = process.env.PORT || 8000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com";
const OPENAI_TOKEN = process.env.OPENAI_API_KEY;

// Zeitlimit fuer den Chat in Minuten (0 = kein Limit).
const CHAT_TIME_LIMIT_MINUTES = Number(process.env.CHAT_TIME_LIMIT_MINUTES ?? 10);
// Ab wann laeuft die Zeit? "first_message" (Standard) = ab der ersten Nachricht,
// "session" = ab dem Laden der Chat-Seite.
const CHAT_TIMER_START = process.env.CHAT_TIMER_START === "session" ? "session" : "first_message";

// Liefert den Zeitpunkt (ms), ab dem keine Nachrichten mehr moeglich sind,
// oder null, wenn (noch) kein Limit laeuft.
function getDeadline(session) {
  if (!CHAT_TIME_LIMIT_MINUTES || CHAT_TIME_LIMIT_MINUTES <= 0) return null;
  let start;
  if (CHAT_TIMER_START === "session") {
    start = session.started_at;
  } else {
    const first = db.getMessages(session.id).find((m) => m.role === "user");
    if (!first) return null;
    start = first.created_at;
  }
  return new Date(start).getTime() + CHAT_TIME_LIMIT_MINUTES * 60 * 1000;
}

const DEFAULT_PROMPT =
  process.env.CHAT_SYSTEM_PROMPT ||
  "Du bist ein hilfreicher Assistent im Rahmen einer wissenschaftlichen Studie. Antworte klar, freundlich und auf Deutsch, sofern die Teilnehmerin oder der Teilnehmer nicht in einer anderen Sprache schreibt.";

// Bedingung (Experimentalgruppe) waehlen: BEDINGUNG=kontrolle bzw. treatment.
// Dann werden Prompt und Quellen aus dem Ordner bedingungen/<name>/ geladen:
//   bedingungen/<name>/prompt.md        -> Systemprompt
//   bedingungen/<name>/quellen/*.md|txt -> Quellentexte (alphabetisch)
// Ohne BEDINGUNG wird wie bisher CHAT_SYSTEM_PROMPT bzw. der Standardprompt genutzt.
function detectBedingung() {
  const fromEnv = (process.env.BEDINGUNG || "").trim();
  if (fromEnv) return fromEnv;
  // Ohne BEDINGUNG: Wenn im Ordner bedingungen/ genau eine Bedingung liegt
  // (ein Repository pro Bedingung), wird diese automatisch verwendet.
  const base = path.join(__dirname, "..", "bedingungen");
  if (!fs.existsSync(base)) return "";
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  return dirs.length === 1 ? dirs[0] : "";
}
const BEDINGUNG = detectBedingung();

function buildSystemPrompt() {
  if (!BEDINGUNG) return DEFAULT_PROMPT;
  if (!/^[A-Za-z0-9_-]+$/.test(BEDINGUNG)) {
    throw new Error(`Ungueltiger Name fuer BEDINGUNG: ${BEDINGUNG}`);
  }
  const dir = path.join(__dirname, "..", "bedingungen", BEDINGUNG);
  const promptFile = path.join(dir, "prompt.md");
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Prompt-Datei fehlt: bedingungen/${BEDINGUNG}/prompt.md`);
  }
  let prompt = fs.readFileSync(promptFile, "utf8").trim();

  const quellenDir = path.join(dir, "quellen");
  const files = fs.existsSync(quellenDir)
    ? fs
        .readdirSync(quellenDir, { withFileTypes: true })
        // Alle normalen Textdateien, mit oder ohne Endung (.md, .txt, keine).
        // Versteckte Dateien und typische Nicht-Text-Formate werden ignoriert.
        .filter((d) => d.isFile() && !d.name.startsWith("."))
        .map((d) => d.name)
        .filter((f) => !/\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|zip)$/i.test(f))
        .sort((a, b) => a.localeCompare(b, "de"))
    : [];
  if (files.length) {
    const blocks = files.map((f, i) => {
      const text = fs.readFileSync(path.join(quellenDir, f), "utf8").trim();
      const titel = f.replace(/\.(md|txt)$/i, "");
      return `<quelle nr="${i + 1}" titel="${titel}">\n${text}\n</quelle>`;
    });
    prompt +=
      "\n\n# Quellen\n" +
      "Die folgenden Quellen stehen dir zur Verfügung. Beziehe dich in deinen Antworten auf diese Quellen, wie oben beschrieben.\n\n" +
      blocks.join("\n\n");
  }
  return prompt;
}

const SYSTEM_PROMPT = buildSystemPrompt();
console.log(
  `Bedingung: ${BEDINGUNG || "(keine, Standardprompt)"} | Prompt-Laenge: ${SYSTEM_PROMPT.length} Zeichen | ` +
    `Prompt-Hash: ${crypto.createHash("sha256").update(SYSTEM_PROMPT).digest("hex").slice(0, 12)}`
);

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

// Allow the app to be called from inside a SoSci Survey iframe. SoSci's
// preview/embedding can load this page in a way the browser treats as
// cross-origin, so without these headers the browser blocks the API calls.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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

  // Optionaler Wiederaufnahme-Token (aus SoSci per URL-Parameter ?t=...).
  // Kommt derselbe Token erneut (z. B. nach dem Zurueck-Knopf), wird die
  // bestehende Sitzung samt Verlauf zurueckgegeben statt einer neuen.
  const rawToken = req.body && req.body.resumeToken ? String(req.body.resumeToken) : "";
  const resumeToken = /^[A-Za-z0-9_-]{12,128}$/.test(rawToken) ? rawToken : null;

  let session = resumeToken ? db.getSessionByResumeToken(resumeToken) : null;
  let resumed = !!session;
  if (!session) {
    session = db.createSession(crypto.randomUUID(), participantId, resumeToken);
  }

  const deadline = getDeadline(session);
  res.status(resumed ? 200 : 201).json({
    sessionId: session.id,
    resumed,
    messages: resumed
      ? db.getMessages(session.id).map((m) => ({ role: m.role, content: m.content }))
      : [],
    finished: !!session.finished_at,
    completionCode: session.finished_at ? session.completion_code : null,
    timeLimitMinutes: CHAT_TIME_LIMIT_MINUTES,
    timerStart: CHAT_TIMER_START,
    deadline: deadline ? new Date(deadline).toISOString() : null,
    serverNow: new Date().toISOString(),
  });
});

app.get("/api/session/:id", (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "not_found" });
  const messages = db.getMessages(req.params.id);
  const { resume_token, ...publicSession } = session;
  res.json({ session: publicSession, messages });
});

app.post("/api/session/:id/message", async (req, res) => {
  const session = db.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "not_found" });
  if (session.finished_at) return res.status(400).json({ error: "session_finished" });

  const content = (req.body && req.body.content ? String(req.body.content) : "").trim();
  if (!content) return res.status(400).json({ error: "empty_message" });
  if (content.length > 4000) return res.status(400).json({ error: "message_too_long" });

  // Zeitlimit serverseitig durchsetzen (kann vom Browser nicht umgangen werden).
  const existingDeadline = getDeadline(session);
  if (existingDeadline && Date.now() > existingDeadline) {
    return res.status(403).json({ error: "time_up" });
  }

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
    const deadline = getDeadline(session);
    res.json({
      reply,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      serverNow: new Date().toISOString(),
    });
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

// Aktiven Systemprompt (inkl. Quellen) anzeigen, zur Kontrolle.
app.get("/api/admin/prompt", (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).send("Forbidden");
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(`Bedingung: ${BEDINGUNG || "(keine)"}\nModell: ${OPENAI_MODEL}\n\n${SYSTEM_PROMPT}`);
});

app.get("/api/admin/check", (req, res) => {
  res.json({ ok: req.query.key === ADMIN_KEY });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
