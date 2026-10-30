<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Every setting*

Finding out what's wrong, and what this TV can play.

<p align="center">
  <a href="https://tivibro.app/view/#tv-set-diag"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag.png" width="49%" alt="Diagnostics"></a>
  <a href="https://tivibro.app/view/#tv-set-diag-test"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag-test.png" width="49%" alt="Connection test"></a>
  <a href="https://tivibro.app/view/#tv-set-caps"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-caps.png" width="49%" alt="What this TV can play"></a>
  <a href="https://tivibro.app/view/#tv-set-diag-log"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag-log.png" width="49%" alt="App log"></a>
</p>

| Setting | Choices | What it does |
|---|---|---|
| **Report a problem** | | Shows a QR code.  Scan it and your phone opens the web editor's **Report a problem** page: say what happened, read everything the TV adds (version, TV model, a few settings, the app and network helper logs, with logins and server names taken out), save the log file, and **Open the GitHub form** opens a bug report filled in for you.  Drag the log file into it and send.  You need a free GitHub account. |
| **Speed test** | | Your internet speed (a download from Cloudflare's speed test service) and your provider's (part of a movie, or a live channel when there are no movies), and what that's enough for: 4K needs about 25 Mbps, Full HD 8 to 10, HD about 5.  It says whether your internet or the provider is the slow part.  Playback stops while it runs, since many providers allow one stream at a time. |
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
