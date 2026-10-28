<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Every setting*

Finding out what's wrong, and what this TV can play.

<p align="center">
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag.png" width="49%" alt="Diagnostics"></a>
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag-test.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag-test.png" width="49%" alt="Connection test"></a>
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-caps.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-caps.png" width="49%" alt="What this TV can play"></a>
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag-log.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag-log.png" width="49%" alt="App log"></a>
</p>

| Setting | Choices | What it does |
|---|---|---|
| **Run connection test** | | Checks, step by step: the network helper, your login, the channel categories and list, a real stream, and each guide source.  Each step says what worked or what failed and why. |
| **View app log** | | What TiviBro did this session.  **▲ ▼** scroll, **CH + / −** page. |
| **View app log with earlier sessions** | | Includes the sessions before, useful after a crash or restart. |
| **View network helper log** | | Every request the helper made: status, time, size, and the network error if any. |
| **Detailed logging** | On · **Off** | Also logs every request and buffer event.  Turn it on while chasing a problem.  It stays on until you turn it off. |
| **Clear log** | | Empties the log. |
| **What this TV can play ›** | | Every video, HDR and sound format, and which player handles it on this TV.  It combines the TV's own answers with what LG TVs are known to do (Dolby Vision and DTS aren't always reported correctly). |
| **Playing now** | (information) | The current stream's format and player. |
| **Status** | (information) | The helper, the network setting, your TiviBro version, the browser engine, how many channels are loaded, and the command for debugging from a computer. |

Logs always mask usernames and passwords.

---

← [Settings: Updates and about](Settings-Updates-and-about)  ·  [Home](Home)  ·  [Turning on the web editor](Turning-on-the-web-editor) →
