(function () {
  // Frontend and backend are served from the same origin (single Express
  // server on Render/self-hosting), so relative paths work directly.
  const API = "";

  const params = new URLSearchParams(window.location.search);
  const participantId = params.get("pid") || params.get("participant") || null;

  const chatLog = document.getElementById("chat-log");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const finishBtn = document.getElementById("finish-btn");
  const chatCard = document.getElementById("chat-card");

  let sessionId = null;
  let busy = false;
  let finished = false;

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
        body: JSON.stringify({ participantId }),
      });
      const data = await res.json();
      sessionId = data.sessionId;
    } catch (err) {
      addMessage("error", "Verbindung zum Server fehlgeschlagen. Bitte laden Sie die Seite neu.");
    }
  }

  async function sendMessage(text) {
    addMessage("user", text);
    setBusy(true);
    const typingEl = addTyping();

    try {
      const res = await fetch(`${API}/api/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      typingEl.remove();

      if (!res.ok) {
        addMessage("error", "Die Antwort konnte nicht abgerufen werden. Bitte versuchen Sie es erneut.");
        setBusy(false);
        return;
      }
      const data = await res.json();
      addMessage("assistant", data.reply);
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

  function showFinishScreen(code) {
    finished = true;
    chatCard.innerHTML = `
      <div class="finish-screen">
        <h2>Chat abgeschlossen</h2>
        <p>Bitte kopieren Sie den folgenden Code und fügen Sie ihn im nächsten Schritt der Umfrage ein.</p>
        <div class="code-box" data-testid="text-completion-code">${code}</div>
        <button type="button" class="btn btn-primary" id="copy-btn" data-testid="button-copy-code">Code kopieren</button>
        <p class="copy-hint" id="copy-hint" aria-live="polite"></p>
      </div>
    `;
    const copyBtn = document.getElementById("copy-btn");
    const copyHint = document.getElementById("copy-hint");
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
