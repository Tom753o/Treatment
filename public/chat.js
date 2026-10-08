(function () {
  // Frontend and backend are served from the same origin (single Express
  // server on Render/self-hosting), so relative paths work directly.
  const API = "";

  const params = new URLSearchParams(window.location.search);
  const participantId = params.get("pid") || params.get("participant") || null;
  // Wiederaufnahme-Token aus SoSci (?t=...). Ermoeglicht es, nach dem
  // Zurueck-Knopf denselben Chat wieder anzuzeigen.
  const resumeToken = params.get("t") || null;

  const chatLog = document.getElementById("chat-log");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const finishBtn = document.getElementById("finish-btn");
  const chatCard = document.getElementById("chat-card");

  let sessionId = null;
  let busy = false;
  let finished = false;
  let deadlineMs = null;      // Zeitpunkt in lokaler Uhrzeit (ms)
  let timerInterval = null;
  let timeLimitMinutes = 0;
  const timerEl = document.getElementById("chat-timer");

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  // Server-Zeitangaben auf die lokale Uhr umrechnen (falls die Uhr des
  // Teilnehmer-Geraets falsch geht).
  function setDeadline(deadlineIso, serverNowIso) {
    if (!deadlineIso) return;
    const offset = serverNowIso ? Date.now() - new Date(serverNowIso).getTime() : 0;
    deadlineMs = new Date(deadlineIso).getTime() + offset;
    if (!timerInterval) {
      timerInterval = setInterval(tick, 500);
    }
    tick();
  }

  function tick() {
    if (!timerEl || finished) return;
    if (deadlineMs === null) {
      timerEl.textContent = formatTime(timeLimitMinutes * 60 * 1000);
      return;
    }
    const left = deadlineMs - Date.now();
    timerEl.textContent = formatTime(left);
    timerEl.classList.toggle("warning", left <= 60 * 1000);
    if (left <= 0) {
      clearInterval(timerInterval);
      timeUp();
    }
  }

  async function timeUp() {
    if (finished) return;
    addMessage("system-note", "Die Zeit für den Chat ist abgelaufen.");
    finished = true;
    sendBtn.disabled = true;
    chatInput.disabled = true;
    // Kurz warten, falls gerade noch eine Antwort unterwegs ist
    const waitForIdle = () => new Promise((r) => {
      const check = () => (busy ? setTimeout(check, 300) : r());
      check();
    });
    await waitForIdle();
    try {
      const res = await fetch(`${API}/api/session/${sessionId}/finish`, { method: "POST" });
      const data = await res.json();
      setTimeout(() => showFinishScreen(data.code, true), 1500);
    } catch (err) {
      addMessage("error", "Bitte klicken Sie auf „Chat beenden“, um Ihren Code zu erhalten.");
      finishBtn.disabled = false;
    }
  }

  function scrollToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addMessage(role, content) {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = content;
    chatLog.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addTyping() {
    const div = document.createElement("div");
    div.className = "typing";
    div.innerHTML = "<span></span><span></span><span></span>";
    chatLog.appendChild(div);
    scrollToBottom();
    return div;
  }

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state || finished;
    chatInput.disabled = state || finished;
    finishBtn.disabled = state;
  }

  async function initSession() {
    try {
      const res = await fetch(`${API}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, resumeToken }),
      });
      const data = await res.json();
      sessionId = data.sessionId;

      // Begruessung bzw. bisherigen Verlauf anzeigen
      if (data.messages && data.messages.length) {
        const note = chatLog.querySelector(".system-note");
        if (note) note.remove();
        data.messages.forEach((m) => addMessage(m.role, m.content));
      }
      if (data.finished) {
        showFinishScreen(data.completionCode, false);
        return;
      }
      timeLimitMinutes = data.timeLimitMinutes || 0;
      if (timeLimitMinutes > 0 && timerEl) {
        timerEl.hidden = false;
        tick();
        setDeadline(data.deadline, data.serverNow);
      }
    } catch (err) {
      addMessage("error", "Verbindung zum Server fehlgeschlagen. Bitte laden Sie die Seite neu.");
    }
  }

  async function sendMessage(text) {
    addMessage("user", text);
    // Countdown sofort mit der ersten Nachricht starten (der Server sendet
    // danach die exakte Endzeit, die diese Schaetzung ersetzt).
    if (deadlineMs === null && timeLimitMinutes > 0) {
      deadlineMs = Date.now() + timeLimitMinutes * 60 * 1000;
      if (!timerInterval) timerInterval = setInterval(tick, 500);
    }
    setBusy(true);
    const typingEl = addTyping();

    try {
      const res = await fetch(`${API}/api/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      typingEl.remove();

      if (res.status === 403) {
        setBusy(false);
        timeUp();
        return;
      }
      if (!res.ok) {
        addMessage("error", "Die Antwort konnte nicht abgerufen werden. Bitte versuchen Sie es erneut.");
        setBusy(false);
        return;
      }
      const data = await res.json();
      addMessage("assistant", data.reply);
      setDeadline(data.deadline, data.serverNow);
    } catch (err) {
      typingEl.remove();
      addMessage("error", "Verbindungsfehler. Bitte versuchen Sie es erneut.");
    }
    setBusy(false);
    chatInput.focus();
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy || finished) return;
    if (deadlineMs !== null && Date.now() > deadlineMs) return timeUp();
    const text = chatInput.value.trim();
    if (!text || !sessionId) return;
    chatInput.value = "";
    chatInput.style.height = "auto";
    sendMessage(text);
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 96) + "px";
  });

  finishBtn.addEventListener("click", async () => {
    if (!sessionId || finished) return;
    finishBtn.disabled = true;
    try {
      const res = await fetch(`${API}/api/session/${sessionId}/finish`, {
        method: "POST",
      });
      const data = await res.json();
      showFinishScreen(data.code);
    } catch (err) {
      finishBtn.disabled = false;
      addMessage("error", "Der Chat konnte nicht beendet werden. Bitte versuchen Sie es erneut.");
    }
  });

  function showFinishScreen(code, timeIsUp) {
    finished = true;
    if (timerInterval) clearInterval(timerInterval);
    if (timerEl) timerEl.hidden = true;
    // Verlauf bleibt sichtbar; Eingabezeile und Fusszeile werden durch
    // den Abschlussbereich ersetzt.
    chatForm.remove();
    const footer = chatCard.querySelector(".chat-footer");
    if (footer) footer.remove();
    const panel = document.createElement("div");
    panel.className = "finish-screen";
    panel.innerHTML = `
      <h2>${timeIsUp ? "Die Zeit ist abgelaufen" : "Chat abgeschlossen"}</h2>
      <p>Bitte kopieren Sie den folgenden Code und fügen Sie ihn im nächsten Schritt der Umfrage ein.</p>
      <div class="code-box" data-testid="text-completion-code"></div>
      <button type="button" class="btn btn-primary" id="copy-btn" data-testid="button-copy-code">Code kopieren</button>
      <p class="copy-hint" id="copy-hint" aria-live="polite"></p>
    `;
    panel.querySelector(".code-box").textContent = code || "";
    chatCard.appendChild(panel);
    const copyBtn = panel.querySelector("#copy-btn");
    const copyHint = panel.querySelector("#copy-hint");
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyHint.textContent = "Code wurde kopiert.";
      } catch (err) {
        copyHint.textContent = "Bitte markieren Sie den Code manuell und kopieren Sie ihn.";
      }
    });
  }

  initSession();
})();
