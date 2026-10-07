# GPT-Chat für Online-Umfragen – Selbst-Hosting-Anleitung

Diese App ist ein kleiner Node.js/Express-Server mit SQLite-Datenbank, der einen Chat mit einem OpenAI-Modell bereitstellt (für die Einbindung als iframe in z. B. SoSci Survey). Diese Anleitung zeigt, wie Sie sie **selbst über GitHub + Render hosten**, statt sie über Perplexity zu betreiben.

## Was ist enthalten

```
server/
  server.js     – Express-Server, Chat-Endpunkt, Export, Admin-Reset
  db.js         – SQLite-Datenbank (better-sqlite3)
public/
  index.html    – Chat-Oberfläche für Teilnehmende
  chat.js
  admin.html    – Adminseite (CSV-Export, Daten löschen)
  admin.js
  style.css
package.json
render.yaml      – Render-Blueprint (optional, für Ein-Klick-Deploy)
.env.example     – Vorlage für Umgebungsvariablen
```

---

## Schritt 1: Code auf GitHub bringen

1. Ein neues, **privates** Repository auf [github.com/new](https://github.com/new) anlegen, z. B. `gpt-survey-chat`.
2. In diesem Ordner lokal:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<ihr-benutzername>/gpt-survey-chat.git
git push -u origin main
```

Die `.gitignore`-Datei sorgt dafür, dass `node_modules/`, die Datenbank und Ihre `.env`-Datei **nicht** mit hochgeladen werden – Ihr OpenAI-Key landet also nicht auf GitHub.

---

## Schritt 2: Auf Render deployen

### Variante A – mit `render.yaml` (empfohlen, wenige Klicks)

1. Auf [render.com](https://render.com) registrieren/anmelden (GitHub-Login geht direkt).
2. **New +** → **Blueprint** → das GitHub-Repository auswählen.
3. Render erkennt automatisch `render.yaml` und schlägt einen Web-Service mit angehängtem Disk (1 GB, für die SQLite-Datenbank) vor.
4. Bei den Umgebungsvariablen (markiert mit „wird beim Deploy abgefragt“) eintragen:
   - `OPENAI_API_KEY`: Ihr eigener Key von [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - `ADMIN_KEY`: ein selbst gewähltes, langes zufälliges Passwort für die Adminseite (z. B. mit einem Passwortgenerator erzeugen)
5. **Apply** klicken. Render baut und startet den Service.

### Variante B – manuell über das Dashboard

1. **New +** → **Web Service** → Ihr GitHub-Repo verbinden.
2. Einstellungen:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** mindestens **Starter** (der kostenlose Free-Plan unterstützt keinen persistenten Speicher – siehe Warnhinweis unten)
3. Unter **Environment** die Variablen aus `.env.example` eintragen, mindestens:
   - `OPENAI_API_KEY`
   - `ADMIN_KEY`
   - `DB_PATH` = `/data/data.db`
4. Unter **Disks** einen Disk hinzufügen: Mount-Pfad `/data`, Größe 1 GB.
5. **Create Web Service** klicken.

Nach dem ersten Deploy erhalten Sie eine URL wie `https://gpt-survey-chat-xxxx.onrender.com`.

---

## ⚠️ Wichtig: Persistenter Speicher

Bei Render gilt: Ohne einen **angehängten Disk** (nur auf kostenpflichtigen Plänen verfügbar) wird die SQLite-Datenbank bei jedem Neustart/Deploy **gelöscht**, weil Render-Dienste sonst nur ein flüchtiges Dateisystem haben. Für eine echte Studie unbedingt:

- Einen **kostenpflichtigen Plan** (mind. „Starter“) mit **Persistent Disk** verwenden (siehe oben, `render.yaml` macht das automatisch), **und**
- `DB_PATH=/data/data.db` setzen, damit die Datenbank auf dem Disk statt im flüchtigen Projektordner liegt.

Der **kostenlose Free-Plan** eignet sich nur zum Testen: Der Dienst schläft nach Inaktivität ein (erste Nachricht nach dem Aufwachen ist dann langsam) und Daten können verloren gehen.

---

## Schritt 3: Testen

1. `https://<ihre-render-url>.onrender.com/index.html?pid=TEST123` im Browser öffnen.
2. Eine Nachricht schreiben, Antwort von GPT prüfen.
3. „Chat beenden“ klicken, Code kopieren.
4. `https://<ihre-render-url>.onrender.com/admin.html` öffnen, den `ADMIN_KEY`-Wert eingeben, CSV-Export prüfen.

---

## Schritt 4: In SoSci Survey einbinden

Nutzen Sie dieselbe Vorgehensweise wie in der separaten SoSci-Anleitung, nur mit Ihrer neuen Render-URL statt der bisherigen:

```html
<iframe
  src="https://<ihre-render-url>.onrender.com/index.html?pid=%caseNumber%"
  width="100%"
  style="aspect-ratio: 0.78; border:none; min-height: 620px;"
  title="Chat-Aufgabe">
</iframe>
```

---

## Zeitlimit (Standard: 10 Minuten)

Der Chat hat ein eingebautes Zeitlimit, das **auf dem Server** durchgesetzt wird – Teilnehmende können es also nicht durch Neuladen der Seite oder Browser-Tricks umgehen.

- Oben rechts im Chat läuft ein sichtbarer Countdown (in der letzten Minute rot).
- Nach Ablauf nimmt der Server keine Nachrichten mehr an und ruft die OpenAI-API nicht mehr auf.
- Der Chat wird automatisch beendet und der Abschlusscode angezeigt.
- Eine Antwort, die kurz vor Ablauf angefragt wurde, wird noch zugestellt.

Einstellen in Render unter **Environment**:

| Variable | Wert | Bedeutung |
|---|---|---|
| `CHAT_TIME_LIMIT_MINUTES` | `10` | Dauer in Minuten (`0` = kein Limit, auch Dezimalwerte wie `2.5` möglich) |
| `CHAT_TIMER_START` | `first_message` | Zeit läuft ab der ersten Nachricht (Lesen der Instruktion zählt nicht mit) |
| `CHAT_TIMER_START` | `session` | Zeit läuft ab dem Laden der Chat-Seite |

Nach dem Ändern einer Variable startet Render den Dienst automatisch neu.

---

## Zurück-Knopf: Chat wieder anzeigen

Wird der iframe mit einem zusätzlichen Parameter `t` (Wiederaufnahme-Token) geladen, zeigt die App beim erneuten Aufruf denselben Chat mit vollständigem Verlauf an, statt einen neuen zu starten.

- Noch nicht beendet und Zeit übrig: Teilnehmende können weiterschreiben, der Timer läuft dabei weiter (er wird nicht zurückgesetzt).
- Bereits beendet: Verlauf und Abschlusscode werden nur angezeigt, keine neuen Nachrichten.
- Ohne `t` verhält sich die App wie bisher (jeder Aufruf = neuer Chat).

SoSci-Code (PHP-Code-Baustein **über** dem iframe auf jeder Chat-Seite):

```php
if (!isset($chatToken)) {
  $chatToken = 'T' . mt_rand(100000000, 999999999) . mt_rand(100000000, 999999999);
  registerVariable($chatToken);
}
replace('%chattoken%', $chatToken);
```

iframe-URL:

```
https://<ihre-render-url>.onrender.com/index.html?pid=%caseNumber%&t=%chattoken%
```

Der Token ist zufällig und nicht erratbar – anders als die fortlaufende Fallnummer. Deshalb wird er (und nicht `pid`) zum Wiederfinden des Chats verwendet, damit niemand durch Ausprobieren von Fallnummern fremde Chats lesen kann.

---

## Kosten & Sicherheit

- **Render:** Der Starter-Plan ist ein Fixpreis pro Monat, unabhängig von der Zahl der Teilnehmenden.
- **OpenAI:** Sie zahlen direkt an OpenAI nach tatsächlicher Nutzung (Tokens), abhängig vom gewählten Modell (`OPENAI_MODEL`, Standard `gpt-4o-mini` – günstig und schnell).
- Der `ADMIN_KEY` schützt Export und Daten-Reset – nicht weitergeben, nicht im Fragebogen verlinken.
- Prüfen Sie vor dem Livegang die Datenschutzhinweise Ihrer Studie: Chat-Inhalte werden in Ihrer eigenen Render-Datenbank gespeichert und (für die Chat-Antworten) an OpenAI übertragen. Für viele institutionelle Ethikanträge lohnt sich ein kurzer Hinweis darauf in der Einwilligungserklärung.
