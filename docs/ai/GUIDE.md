# TiviBro for AI assistants

This file is for people who build TiviBro features with an AI assistant (Claude, ChatGPT, Gemini, Copilot, Cursor and the like), and for the assistant itself.  Give your assistant the full knowledge base, not just this page:

- **Download:** <https://tivibro.app/ai/tivibro-for-ai.md> (rebuilt from `main` every time the website deploys), or run `npm run ai` in your clone to write `tivibro-for-ai.md` from your own checkout.
- **Chat assistants** (claude.ai, ChatGPT, Gemini): attach the file at the start of the conversation, then describe what you want to build.
- **Coding agents** (Claude Code, Codex, Cursor, Copilot agent mode): they read `CLAUDE.md` or `AGENTS.md` in the repository by themselves, which point here.  For a big change, give them the full file too.

The rest of this page is written to the assistant.

---

## What TiviBro is

A free, open-source IPTV player for LG webOS TVs, built to feel like TiviMate and go further.  People bring their own Xtream Codes or M3U subscription with an XMLTV guide; TiviBro provides no channels, streams or playlists.

Four parts live in this repository:

1. **The TV app** (`app/`): plain HTML, CSS and JavaScript in one webOS web app (`app.tivibro.tv`).  No framework, no bundler, no modules: scripts load in order from `app/index.html`, and each file exposes one global (`Views`, `Player`, `Store`...).
2. **The network helper** (`service/`): a Node.js webOS service (`app.tivibro.tv.service`) bundled in the same IPK.  A localhost relay on 127.0.0.1:47811 that gets around CORS, plus big jobs the app can't afford in memory (guides, movie lists), the web editor's LAN server, reminders, and the phone app's LAN API on port 47810.
3. **The web editor** (`service/editor/index.html`): one big page the helper serves on the home network (port 8787 by default) for editing channels, groups, guides, playlists and backups from a phone or computer.
4. **The Android app** (`android/`): Kotlin and Jetpack Compose.  Pairs with the TV and works as a remote, Play on TV, and the editor full screen.  Built only in CI.

Also here: `site/` (tivibro.app, GitHub Pages), `relay/` (a Cloudflare Worker that turns problem reports into GitHub issues and counts anonymous installs), `scripts/` (build, release, wiki, stats), `tests/` (unit, soak, engines, Android), `docs/` (user guide, architecture, compatibility, wiki source).

## Rules that are not optional

**Old TVs.**  One IPK runs on webOS 4 to 26.  App code must parse and run on Chromium 53: no `async`/`await`, no object spread, no optional chaining or `??`, no CSS grid, no `\p{...}` Unicode property classes in regular expressions, no `gap` without the `nogap` fallback (`npm run nogap`).  Newer APIs only behind a `typeof` check with a fallback (`AbortController`, `DecompressionStream`, `TextDecoder`).  The helper service is plain ES5 for Node 0.12: `var` and `function`, callbacks, no arrow functions, no template literals, no `let`/`const`.  `bash tests/engines/run.sh` runs the app and helper on the old Chromium and Node builds (`npm run lint` only checks syntax with today's Node, so it won't catch these).  See `docs/COMPATIBILITY.md`.

**The remote first.**  Every feature works with arrows, OK and Back alone, and with the Magic Remote's pointer.  Back always goes up one level.  Hold OK (600 ms) opens options.  Views receive action names (`up`, `ok`, `hold`, `back`, `red`, `long:info`...) from `UI`, never key codes.

**Speed and memory.**  Lists stay fast with 15,000 channels (`VList` pools rows), nothing slows a channel starting, and webOS closes an app at roughly 500 MB.  Big data belongs in the helper or IndexedDB, not in app memory; keep objects flat and short-keyed.

**Never lose the user's work.**  The provider's data is never changed: hiding, renaming, custom groups and sorting are overlays (`Store.edits`) keyed by stable channel keys, so a playlist refresh keeps every edit.  Anything destructive asks first or can be undone.

**Show the current state.**  Every settings page, status line and screen shows what is true now, and updates when it changes (see `Settings.live`, `WebEdit.onStatus`).

**Nothing plays by itself.**  TiviBro never starts video on its own (no autoplay after setup or a playlist change).  The only exception is the user's own "Turn on last channel at launch" setting.

**No secrets anywhere.**  Never put a provider address, username, password or stream link in code, tests, fixtures, screenshots, logs or issues.  Logs mask credentials (`Log`), the web editor never receives logins (only server names), and tests use `tests/mock/mock_provider.js` (any login works; `demo` / `demo`).  Real-provider tests (`tests/real/`) read logins from a file outside the repository.

**Privacy.**  The TV app has no analytics.  The only thing it sends about itself is an anonymous daily count (version and webOS version, no ID, `Update.countMe`), which users can switch off.  Don't add telemetry, tracking IDs, third-party SDKs or remote calls without a matching line in `docs/wiki/Privacy-and-security.md` and `site/privacy/index.html`.

**Shared files stay in sync.**  `app/js/names.js`, `tidy.js`, `pubepg.js`, `links.js` and `events.js` are copied into `service/editor/` by `npm run build`; lint fails if a copy differs.  Edit the `app/js/` original and run the build (or copy the file).

**Writing style for anything a person reads** (UI text, the user guide, the changelog, release notes, issue replies): plain words for viewers, not developers; two spaces between sentences; never an em dash (use a colon, a comma or a new sentence).  Say what happens and what to press, with screen names in bold in docs (**Settings > Playback and buffering**).

## How a change is made

1. Read the files you will touch.  Each source file starts with a comment that explains what it does and why; keep it accurate when you change the file.
2. Make the change in the right layer (see "Where things go" below).
3. Add or update tests: a unit test in `tests/unit/` (plain Node, `ok(name, condition)` style, added to `test:unit` in `package.json`), and for anything on screen a soak test in `tests/soak/` that drives the app in Playwright against the mock provider.
4. User-facing change: a line under `## Unreleased` in `CHANGELOG.md` with a **bold headline that makes sense on its own** (release notes show only the headline), and the user guide (`docs/USER-GUIDE.md`; the wiki is built from it with `node scripts/wiki/build.js`).  New settings go in the guide's settings tables.
5. Run `npm run lint` and `npm test`.  For screens, run the soak test (`node tests/mock/mock_provider.js`, `npm run serve`, then `node tests/soak/<name>.js`).  For old TVs, `bash tests/engines/run.sh browser`.
6. Open a pull request against `main` and fill in the template.  Don't edit the `homebrew` branch, release files, the version number or release notes: maintainers cut releases.

## Where things go

| You want to | Do it in |
|---|---|
| Add a setting | A default in `Store`'s `DEFAULTS` (`app/js/store.js`), a row in `app/js/settings.js` (`choice`, `toggle`, `action`, `page`, `info`), the behaviour where it applies, and a row in the user guide's settings table |
| Add a remote action | `Keymap.ACTIONS`, `SHORT` and `CONTEXT_ACTIONS` (and `DEFAULTS` if it gets a button) in `app/js/keymap.js`, then a `case` in `Views.runAction` (`app/js/views.js`) |
| Add a quick menu button | `QP_BUTTONS` and `qpActions()` in `app/js/views.js` |
| Change the guide | `app/js/epg.js` (app side, worker), `service/guide.js` (helper side for big guides): keep the two matching rules in step |
| Change channel loading or a provider format | `app/js/source.js` (Xtream Codes and M3U into one compact channel shape) |
| Change what a channel or group name shows | `app/js/names.js` (rules) or `Library` overlays (`app/js/library.js`) |
| Change Movies and Shows | `app/js/vod.js` (lists, languages, categories, playback), `service/vod.js` (the helper slims big lists) |
| Change playback | `app/js/player.js` (engines, buffering, reconnects), `app/js/caps.js` (what the TV decodes), `app/js/mkvsubs.js` (MKV subtitles) |
| Add a web editor page or action | `service/editor/index.html` (the page) and the `RUN` table in `app/js/webedit.js` (commands the TV carries out); the browser sends `POST /api/command {type, args}` |
| Add a helper route | `service/proxy.js` routes to modules like `service/guide.js` and `service/vod.js`; plain ES5; bind localhost only unless it is the editor or phone LAN server |
| Change the phone app protocol | `service/companion.js` (TV side), `app/js/phone.js` (TiviBro side), `android/.../proto/` (phone side), `docs/wiki/Phone-app-protocol.md`, and the Android tests (`tests/android/fake-tv.js`) |
| Change the first-run screens or the set-up tour | `App.setup` in `app/js/app.js`, `app/js/tour.js` |
| Change the website | `site/` (deployed by `.github/workflows/pages.yml`) |

## Storage

- `localStorage`: `tivibro.settings` (all settings, playlists with their logins) and `tivibro.edits.<playlist id>` (the user's overlays).  Changes go through `Store.saveSettings()` and `Store.saveEdits()`.
- IndexedDB `tivibro`: channel lists (`playlist:<id>`), movie and show lists (`vod:<id>:movie|series`), restore points.
- Backups (`Backup` in `app/js/webedit.js`) carry settings and edits; keys in `KEEP_LOCAL` stay with the TV.

## Things that look like bugs but are on purpose

- The Phone app settings section shows only in test builds (`alpha` or `beta` versions).
- Video for the TV's own player goes direct for http and through the helper for https or a custom User-Agent; MKV files with subtitles share one resolved session URL between the player and subtitle reads (`mkvsubs.js`).
- New editor passwords and pairing codes leave out look-alike characters (`0/O`, `1/I/L`, `2/Z`, `5/S`, `6/G`, `8/B`, `U/V`); the editor login treats look-alikes as the same.
- Headless Chromium can't decode HEVC or AC-3; a stream that fails in a soak test may play fine on a TV.
- `docs/wiki/` is generated from `docs/USER-GUIDE.md`: edit the guide, not the wiki pages.

## Asking for a change

A prompt that works well, after attaching the knowledge base:

> I want to add *(the feature)* to TiviBro.  Viewers should see *(what changes on screen)* and use it with *(which buttons)*.  Follow the rules in the knowledge base: Chromium 53 and Node 0.12 compatible, remote first, no secrets, tests, a CHANGELOG line and the user guide.  First list the files you'll change and why, then show the changes.

Ask your assistant to show you the files it plans to change before it writes code, and paste back test output if anything fails.
