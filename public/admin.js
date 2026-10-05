(function () {
  // Frontend and backend are served from the same origin (single Express
  // server on Render/self-hosting), so relative paths work directly.
  const API = "";

  const keyInput = document.getElementById("admin-key");
  const downloadBtn = document.getElementById("download-btn");
  const status = document.getElementById("status");
  const resetBtn = document.getElementById("reset-btn");
  const resetStatus = document.getElementById("reset-status");

  downloadBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) {
      status.textContent = "Bitte geben Sie den Admin-Schlüssel ein.";
      return;
    }
    status.textContent = "Prüfe Schlüssel…";
    try {
      const check = await fetch(`${API}/api/admin/check?key=${encodeURIComponent(key)}`);
      const data = await check.json();
      if (!data.ok) {
        status.textContent = "Falscher Schlüssel.";
        return;
      }
      status.textContent = "Download wird gestartet…";
      window.location.href = `${API}/api/export?key=${encodeURIComponent(key)}`;
    } catch (err) {
      status.textContent = "Verbindungsfehler. Bitte erneut versuchen.";
    }
  });

  resetBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) {
      resetStatus.textContent = "Bitte geben Sie den Admin-Schlüssel ein.";
      return;
    }
    const confirmed = window.confirm(
      "Wirklich ALLE Sitzungen und Nachrichten unwiderruflich löschen? Dies kann nicht rückgängig gemacht werden."
    );
    if (!confirmed) return;
    resetStatus.textContent = "Prüfe Schlüssel…";
    try {
      const check = await fetch(`${API}/api/admin/check?key=${encodeURIComponent(key)}`);
      const data = await check.json();
      if (!data.ok) {
        resetStatus.textContent = "Falscher Schlüssel.";
        return;
      }
      resetStatus.textContent = "Lösche Daten…";
      const res = await fetch(`${API}/api/admin/reset?key=${encodeURIComponent(key)}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("reset_failed");
      resetStatus.textContent = "Alle Daten wurden gelöscht.";
    } catch (err) {
      resetStatus.textContent = "Verbindungsfehler. Bitte erneut versuchen.";
    }
  });

  (function () {
    const t = document.querySelector("[data-theme-toggle]"),
      r = document.documentElement;
    let d = matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
    r.setAttribute("data-theme", d);
    t.addEventListener("click", () => {
      d = d === "dark" ? "light" : "dark";
      r.setAttribute("data-theme", d);
      t.setAttribute("aria-label", "Switch to " + (d === "dark" ? "light" : "dark") + " mode");
    });
  })();
})();
