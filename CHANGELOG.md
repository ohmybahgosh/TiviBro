# Changelog

## 0.6.0 (alpha 6, 2026-10-28)

Pre-release: expect rough edges, and keep a backup before installing.

### New in alpha 6

- Quicker starts, same stability (buffer profiles unchanged):
  - CH+ / CH− and Last channel: a lone press starts the channel at once instead of after 300 ms; presses in quick succession still wait until you stop, so surfing opens one stream rather than many.  A single press to a moving picture went from about 0.72 s to 0.15 s against the mock provider (and 0.42 s to 0.15 s with a provider that allows one connection).
  - Channel numbers: switch as soon as the number can't get any longer (typing 12 when there is no 120 or longer), instead of waiting 1.4 s for another digit.  Same in the guide.
  - The helper keeps DNS answers for a minute (dropped when connecting fails), so channel changes and redirects don't wait on the TV's resolver.  Node 20's list form is supported; Node 0.12 ignores it.  Test: `tests/unit/proxy-dns.test.js`.
- Faster channel changes.  Until the first frame, the player checks every 50 ms whether enough is buffered, instead of on its 400 ms watchdog.  Video is usually ready 100 to 200 ms after a change, so pictures now appear about 300 ms sooner: 0.42 to 0.12 s in a desktop browser, and 0.86 to 0.47 s with the CPU slowed to TV speed (median of 10 changes).  Test: `player.test.js`.
- Player audit (`docs/COMPATIBILITY.md`, "Video decoding and hardware"): every stream already uses the TV's hardware decoder, demuxing runs in a background worker, and steady playback costs about 1% of a core.  Measured and left as they are: the demux worker (no measurable cost to channel changes) and the MPEG-TS stash buffer (resizes itself after the first second).
- Test channel "Chaos Real Time" (912): no head start, data at exactly real time from the first byte.
- Compatibility pass across webOS 4 to 26 ([`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)):
  - HEVC channels on webOS 4: mpegts.js uses `padStart` (Chromium 57) when it reads an HEVC stream, and hls.js uses `Object.entries` (Chromium 54).  `compat.js` now polyfills both, plus `Object.values` and `padEnd`.
  - Never a black screen: on webOS 3 and older the app says the TV is too old (needs webOS 4, 2018 or newer); if part of the app fails to load or start, it says so with the details and OK tries again.
  - Logos and posters on older TVs: an https image that fails (2018 to 2020 TVs without updates don't trust today's Let's Encrypt certificates) gets one more try through the helper.
  - Symbols (↺ ★ ▶ ✓ ⚠) on every TV: a 4 KB fallback font (subset of DejaVu Sans) for TVs whose fonts lack them; the Settings text no longer uses the emoji-only ⏪ ⏩.
  - Less memory for big guides: past programmes are kept only for catch-up channels, the rest keep the last three hours (on a 15,000-channel, 211 MB guide: 128 instead of 163 MB).  webOS 4 and 5 keep shorter programme descriptions.
  - Sloppy providers on webOS 22 and later: the helper uses Node's lenient HTTP parser, so replies with stray control characters in headers or bare LF line endings work as they did on older TVs.  Tests: `tests/unit/proxy-lenient.test.js`.
  - webOS 26 (Chromium 132) is recognised as 26.
  - A full storage no longer loses changes silently (one message, and it's logged), and an aborted guide-cache write no longer leaves anything waiting.
  - `compat.test.js` now also checks the bundled players, the stylesheets (CSS Chromium 53 ignores), the polyfills, the "too old" screen, version detection, the symbol font and `appinfo.json`; `npm run soak:boot` checks the start-up screens in a browser.
- Backup versions of a channel.  When a live channel stops working for good, TiviBro switches to another version of the same channel (another quality, group, or a copy you hid) and says so, steadiest first: Full HD, HD, unmarked, 4K, SD.  If every version fails (the provider is down), it goes back to the channel you chose and keeps retrying, so the picture still returns by itself.  **Settings > Playback and buffering > When a channel stops working**: switch, ask me, or keep retrying.  **Other versions…** in channel options and the quick menu.  Matching keeps countries, East/West feeds and numbered channels apart (`Library.versions`).  Tests: `tests/unit/library.test.js`, `npm run soak:backup`.
- Quality tags (FHD, HD, SD, 4K) beside channel names in lists and the guide, where the same channel appears more than once.
- Faster guide on big playlists.  Scrolling moves rows instead of redrawing them and reuses programme cells, the time header is rebuilt only when the time window moves, and the details panel waits until the remote rests while an arrow is held.  Measured on 15,000 channels with the CPU slowed to TV speed: a step down 56 to 33 ms, holding Down 18 to 24 rows a second with no long tasks (was 15), page down 150 to 114 ms, and a fifth of the DOM churn.  The channel list's info panel also waits while an arrow is held.
- Quick menu: line icons instead of mixed symbols, the row slides to keep the highlighted button in view when there are more than fit, moving only moves the highlight (opening it went from 139 to 18 ms), and a new **Other versions** button.
- Guide rows: the catch-up mark is just ↺ (the days are in the details), leaving room for names.
- Stream info no longer shows the previous channel's numbers while a channel is connecting.
- Speed and backup tooling: `npm run soak:speed` (key-to-screen times and held-arrow scrolling, CPU slowed to TV speed), `MOCK_BIG=15000` for a provider-sized mock playlist, `npm run soak:backup`.

### In alpha 5

- Homebrew Channel repository.  In the Homebrew Channel, **Settings > Add repository** with `https://raw.githubusercontent.com/ohmybahgosh/TiviBro/homebrew/repo.json` (releases; until the first one, the newest test build) or `…/repo-testing.json` (every build).  The Release workflow keeps both on the `homebrew` branch, with the manifest inside each entry, since the Homebrew Channel can't read GitHub release links from the TV.  `scripts/update-homebrew-repo.js`, tests: `tests/unit/homebrew.test.js`.
- Every build has its own package version, so the Homebrew Channel sees updates between test builds: test builds sort below their release (`0.6.0-alpha.5` installs as `0.5.10005`, `scripts/pkg-version.js`).  TiviBro still shows the full name.  IPK links in manifests are absolute and pinned to their tag.
- One-line installer: now at `https://raw.githubusercontent.com/ohmybahgosh/TiviBro/homebrew/install.sh`, installs the newest test build while there is no full release yet, and prints the release name instead of the package version.
- The repository is public, with an active-development notice at the top of the README.
- Playback on sloppy streams, tuned against a new set of deliberately broken test channels (see below):
  - A cushion that grows: when a live channel keeps running dry, TiviBro waits for a bigger buffer before playing again, up to 20 seconds depending on the buffer profile, and lets it shrink back after three clean minutes.  The refill shows as *Buffering NN%*, and never waits more than about 4 seconds once the base buffer is there.
  - Timestamp jumps: when a provider's stream jumps back or ahead (an upstream restart), playback follows the stream instead of freezing on the old position.
  - Starvation: a refill that gets no new data for 4 seconds reconnects instead of waiting for the watchdog.
  - HTTP errors after a channel has played (a provider at its connection limit, a brief 404) reconnect on the same player instead of switching players.  Busy answers (403, 429, 503 and similar) get five tries before the next player.  Retries back off to at most 5 seconds, and the slow-retry phase tries every 6 seconds for the first 3 minutes before easing to every 15.
  - HLS recovers from network errors mid-stream by reloading, before reconnecting.
  - Corrupted MPEG-TS: the network helper keeps packets aligned (`service/tssync.js`), dropping stray bytes instead of passing them to the demuxer, which used to stall until the channel was reconnected.  Anything that isn't TS passes through untouched.  Tests: `tests/unit/tssync.test.js`.
  - mpegts.js: null guards for callbacks that arrive after the player was destroyed (fast zapping); documented in `app/vendor/PATCHES.md`.
  - Results in headless Chromium, percent of time the picture moved: corrupted data 68 to 100, mixed trouble 68 to 86, a 60-second provider outage 26 to 58 (back about 3 seconds after the provider returns), stalls 86 to 88.
- The guide opens in the grid on the last channel the first time, instead of on the group list.
- Soak tests (Playwright): `npm run soak:chaos` plays eleven broken test channels (`MOCK_CHAOS=1`, `tests/mock/chaos.js`) and reports freezes, reconnects and time moving; `npm run soak:zap` makes 300 fast channel changes and checks playback, memory and menus afterwards; `npm run soak:monkey` presses random remote keys across every screen looking for errors and dead ends.  `make-media.sh` now also writes the 10-minute `chaos.ts` clip.  See the Developing wiki page.

### In alpha 4

- Updates from the TV.  New **Settings > Updates and about** (`app/js/update.js`): shows the version, checks GitHub releases (once a day by itself, or on demand), lists what's new, and on rooted TVs with the Homebrew Channel installs the update through `luna://org.webosbrew.hbchannel.service/install` with the SHA-256 from the release manifest, then restarts into the new version.  "Include test versions" offers alpha and beta builds (on by default when running one).  Other TVs see the update and how to install it.  Tests: `tests/unit/update.test.js`.
- One-line installer for rooted TVs: `scripts/tv/install.sh`, published with every release as `install.sh`.  `curl -fsSL …/releases/latest/download/install.sh | sh` downloads the newest release, checks its SHA-256 against the manifest, installs it with the TV's installer and starts TiviBro; `--pre`, `--tag`, `--ipk`, `--sha256`, `--no-launch`.  POSIX sh for BusyBox, ES5 node for webOS 4.  Tests: `tests/unit/tv-install.test.js` (fake GitHub and installer).
- Release builds stamp the full version (for example `0.6.0-alpha.4`) into the app, so updates compare test versions correctly; `appinfo.json` stays `X.Y.Z`.  Release notes include the one-line install command.

### In alpha 3

- Zipped guides on every TV.  The network helper now unzips guide downloads (`service/unzip.js`, relay prefix `/unz/<id>`), so `.xml.gz` sources work on webOS 4, 5 and 6 too, where the browser has no `DecompressionStream`.  It also handles `Content-Encoding: gzip` and `deflate`, provider guides that are gzipped without saying so, and files zipped twice, and asks servers for compressed transfers.  Progress counts the zipped bytes (`/xfer/<id>`), so percent and time left stay right.  With Network set to Direct, older TVs get a clear message instead of a guide that silently fails.  Tests: `tests/unit/unzip.test.js`.

### In alpha 2

- webOS compatibility, one IPK from webOS 4 to 26 with webOS 25 as the main target ([`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)):
  - `requiredACG` in `appinfo.json` (`systemconfig.query`, `activity.operation`), checked by webOS 26 and required from 27.
  - `app/js/compat.js`: `Promise.prototype.finally` for Chromium < 63, and flexbox `gap` detection; `app/css/nogap.css` (generated by `npm run nogap`) spaces flex layouts with margins on Chromium < 84 (webOS 6 and older).
  - Stream diagnostics no longer need `AbortController` (Chromium < 66).
  - `service/compat.js`: `Object.assign`, `Buffer.from` and `timingSafeEqual` for the old Node on webOS 4 and older.
  - `tests/unit/compat.test.js`: app parses on Chromium 53, helper on Node 0.12, no unguarded newer APIs, shims work, `nogap.css` current, ACG covers every Luna call.

### In alpha 1

- Streams that don't quit.  Reconnects wait a little longer each time (with jitter), a dropped Wi-Fi is waited out without spending retries and reconnects the moment the TV is online, and a channel that keeps failing tries the TV player and the provider's HLS version, then retries every 15 seconds for up to 20 minutes with a message on screen.  An HTTP error before the first frame gets two quick retries (a provider's connection limit while the last channel hangs up) before the next player, instead of marking the whole server for the TV player.  Movies and catch-up resume at the same spot after a drop, after leaving the app and coming back, and when the TV player reports "ended" mid-film.  Long-paused live TV lets the connection go and Play returns to live.  Error messages say what happened, and OK on them tries again from the top.
- HDR, Dolby Vision and codecs.  New `caps.js` reads what each stream is (HLS master playlist, mpegts.js media info, Xtream movie details) and routes it before the first frame: Dolby Vision to the TV player, HDR10 and HLG to the built-in player by default (**Settings > Playback > HDR and Dolby Vision** can send all HDR to the TV player), codecs MSE refuses to the TV player.  Known LG rules on top of what the TV reports: HEVC, AC-3 and E-AC-3 on webOS 4+, AV1 on webOS 5+, Dolby Vision 5/8 on the TV player, and no DTS on 2020 to 2022 models (C1, C2).  DTS-only and surround FLAC movies warn about sound.  The info panel and movie details show the format ("4K  HEVC  Dolby Vision 8  E-AC-3 5.1 Atmos").  **Diagnostics > What this TV can play** lists everything.
- hls.js full build instead of the light one, for separate audio tracks and subtitles in HLS.
- Remote and Magic Remote: Play and Pause do what they say; channel lists wrap and held arrows stop at the ends; Up at the top of a list no longer opens the menu; Info opens options in lists and the guide; the channel list over the video keeps open while you switch and closes on the playing channel; movie seeking speeds up as you keep pressing, previews the landing point and end time, and Back cancels it; confirmations focus Cancel; clicking outside a pop-up closes it; clicking the progress bar seeks; Settings rows show clickable ‹ › arrows.
- Appearance: nine backgrounds (new Ocean, Forest, Plum, Mocha and High contrast), twelve accents plus Custom (hue and brightness from the remote), colour swatches, text on the accent picks dark or white for contrast, and a "Filled with outline" focus style.
- Tests: `caps.test.js`, `player.test.js` (fake video and clock: reconnect, offline, retry ladder, resume, routing, live pause, suspend) and `look.test.js`.

- README rebuilt around recordings of the real app: animated walkthroughs of the guide, zapping, catch-up, groups, movies and shows, search, multiview and settings, plus the web editor and a fresh-TV restore shown side by side with the TV.  Every image opens full size, with a full-quality MP4 beside each animation.
- New [user guide](docs/USER-GUIDE.md) covering every remote button, screen and setting on the TV, every page of the web editor, backups and troubleshooting.
- GitHub wiki pages in `docs/wiki/`, built from the user guide (`npm run wiki`) and published with `npm run wiki:publish`.
- Demo tooling: a fictional Xtream provider with guide, catch-up, movies and shows (`tests/mock/mock_provider.js`), synthetic demo streams, and scripts that record and encode every clip and screenshot (`scripts/demo/`).
- Movies and shows: the details panel no longer sits under the clock.
- GitHub Actions: CI (lint, tests, test build) on every push and pull request, and a Release workflow on `vX.Y.Z` tags that builds the IPK, writes the Homebrew Channel manifest and `repo.json`, and publishes a GitHub release with notes from this file.  `npm run release` tags and pushes after checking everything locally.
- Renamed to **TiviBro**.  App ID `app.tivibro.tv`, helper `app.tivibro.tv.service`, storage keys `tivibro.*`.  On a TV this installs as a new app; remove the old one after restoring your backup.
- New logo: glossy blue "V" app icon (80 and 130 px), "tVb" splash screen, "tiviBro" wordmark on the first-run and loading screens and in the web editor, V mark in the side menu, editor favicon.  Cleaned artwork (speckles removed, light-background versions) lives in `logos/clean/`.
- Full, locked backups.  A backup now holds everything (settings, every playlist with its login, each playlist's edits and restore points) and is always locked with a passphrase: the helper encrypts it (AES-256-GCM, key from PBKDF2-SHA256, 200,000 rounds) before it leaves the TV, so the browser and the downloaded `.tivibro` file never hold readable logins.  "Suggest one" makes a strong passphrase.  Restoring sends the file and passphrase to the helper (`/api/restore`), which checks it (wrong passphrase or a changed file is refused), shows the playlists inside (names and servers only), then hands it to the TV.  Older unlocked backups still restore, with a warning.
- Fresh TV restore: the first-run screen has "Set up or restore from a computer", which starts the web editor and shows its address and password in big type.  The editor opens on a Welcome page (restore a backup, or add a playlist with a real keyboard) and moves on by itself once the TV has a playlist.  The first playlist added from the editor is switched to automatically.
- New look, "Midnight Electric": deep navy with electric blue and cyan, on the TV and in the web editor.  Amber stays only for warnings.  The old amber default switches over once; a colour you picked yourself is kept.  The old colours remain as the "Classic (1.0)" background, and the accent list gains Cyan, Violet, Mint, Teal and Ember.
- Web editor, usability overhaul:
  - Drafts and a change bar: edits stay in the browser until "Send to TV" (Ctrl+S), or switch on "Send automatically".  Review lists every pending change in plain words.  Drafts survive a page reload and are offered back.
  - Undo and redo (Ctrl+Z, Ctrl+Shift+Z) for every edit, plus a session history with "Go back" to any step.
  - Restore points on the TV (IndexedDB `snaps:<playlist>`): one automatically before each set of changes from the computer (last 15 kept) and named ones (up to 30).  Restoring makes a point first, so it can be undone.  New commands: listSnaps, makeSnap, restoreSnap, deleteSnap.
  - Copy or move channels into any group, provider groups included (new edits `groupAdd`, `groupRemove`), with "take out of this group" and a one-click "put this group back".  Provider groups show an "edited" tag.
  - Per-group sort dropdown (provider order, A to Z, Z to A, channel number, your order), new edit `groupSort`, honoured on the TV.
  - Your own groups show "renamed" after a rename (original kept as `orig`).
  - Custom dropdowns replace the browser's: a click opens the list and only a later click picks, so the opening click can no longer select the option under the pointer.  Type to filter, arrow keys work.
  - Guide page rebuilt: the provider's guide options are explained as cards (per channel, full XMLTV, off), Full XMLTV asks first, and guide loads now show live progress (MB, percent, speed, time left, programmes read).  Guide commands answer at once and load in the background, so nothing looks frozen.
  - Recommended free guides by region (epgshare01, iptv-epg.org, i.mjh.nz, dp247 Freeview on GitHub, iptv-org/epg), each with Test and Add.  Guide sources can be tested, reordered and given offsets.
  - Smart match: fuzzy name matching that understands quality tags, country codes, East/West feeds, numbered channels and US call signs, with confidence levels and approve/decline per guess.  Matching tabs: needs a guide, provider only, matched by you, matched on its own, waiting for the TV.  The manual picker ranks suggestions with a match percentage.
  - Smart clean-up page: keep only chosen countries (group name prefixes), duplicate finder with a preferred quality, hide by keyword with preview, hide empty groups.  Overview shows smart suggestions.
  - Help page with sections for every tool, and short notes with "Learn more" links on each page.  Busy bar, button spinners and elapsed-time messages for every TV action.
- TV: guide download progress (bytes counted as they arrive) in a corner chip and sent to the web editor (`/editor/progress`, returned by `/api/rev` with `tvSeen`).
- Tests: `tests/unit/library.test.js` (copy, move, take out, per-group sort); editor test covers progress.

### Earlier in this release
- Web editor redesigned: side navigation with Overview, Groups and channels, Guide matching, Channel names, Playlists, Backup and restore.
  - Overview: stats (channels shown, groups shown, hidden, favorites, own groups, guide coverage, catch-up), a five-step clean-up checklist, one-click clean-ups (hide all, recommended names, hide empty groups, show all).
  - Groups and channels: rename provider groups (new `groupRenames` edit, also used on the TV), filters (shown / hidden / without guide data), Sort A–Z for your groups, Find and replace across channel names (plain or regular expression, selected / group / all, with preview), catch-up badges.
  - Guide matching: coverage, provider guide mode, add/remove XMLTV sources, reload guide, list of channels without guide data, searchable picker that assigns a guide channel (`epgMap`).
  - Playlists: add Xtream Codes or M3U accounts (the TV logs in and loads before saving), use on the TV, reload, edit name / User-Agent / refresh intervals / login (tested before saving), delete.
  - Backup and restore: download a full backup (settings, all playlists with logins, each playlist's edits); restore from a file with a summary first; the TV restarts TiviBro and the editor reconnects by itself.
- Helper: command queue for actions the TV must carry out (`/api/command`, `/api/result`, `/editor/result`); more tests in tests/unit/editor.test.js.
- Edit on a computer (Settings > Edit on a computer): the network helper serves a web editor on the TV's address (port 8787, 8080, 8000 or 9090) behind a random 8-character password shown on the TV.  In a browser: show/hide and drag-reorder groups, create/rename/delete your own groups, search all channels, hide/show, rename, favorite, add to groups in bulk, reorder channels inside your groups, and edit the channel-name rules with a live preview.  Changes reach the TV within a few seconds; changes made on the TV show up in the browser.  Off at every app start, stops when the app closes; wrong passwords lock out for a minute after 5 tries; no provider address, login or stream links are ever sent to the browser.
- TiviMate settings review (see docs/TIVIMATE-PARITY.md).  Added:
  - Playback: per-channel picture size (or for all channels), HLS video quality, playback speed for catch-up and movies, subtitles menu and "subtitles on automatically", separate ⏪ ⏩ step, ◀ on catch-up channels can be Rewind or Last channel, black screen while switching, info panel on switching on/off, stream details in the info panel.
  - Guide: how what's on now is marked (progress fill / colour / off), channel names on/off (logos-only guide widens the schedule), two-line channel names, catch-up marks on/off.
  - Groups: Favorites group on/off, hide groups the provider adds later, All channels can include hidden groups.
  - Appearance: background theme (dark blue / black OLED / slate), text size, panel transparency over video, logo source (playlist or guide), date with the clock; the clock now sits top right on every screen.
  - Remote: choose which Quick menu buttons appear (TV guide button added).
  - Reminders: ask or switch automatically, how long the question stays.
  - Playlists: custom User-Agent per playlist, sent by the network helper (tests/unit/proxy-ua.test.js).
- Side menu replaces the top bar: icons down the left edge, labels when opened with ◀ (or the pointer), hidden in the guide grid and fullscreen.
- Guide layout: preview window top left; top right shows title, LIVE / CATCH-UP / UPCOMING, air time, length, time left, channel, group, catch-up days, a progress bar and the description.  Opening the guide shows the groups panel (▲▼ choose, the grid follows); ▶ enters the grid and hides the menu and groups; ◀ on what's on now brings them back.
- Previewed channel to fullscreen from anywhere in the guide: the Play button or clicking the window.  Back always goes up one level (grid, groups, menu), and Back on the home menu asks before exiting.  ("In the window: <channel>" stays on screen while you browse.)
- Fullscreen OK opens a TiviMate-style quick menu: channel list, watch from start (catch-up only), favorite, audio, subtitles (when present), picture size, multiview, sleep timer, stream info, reconnect, and a row of recent channels.  Remappable (Remote control settings); old remote maps migrate automatically.
- Movies and Shows only appear in the menu when the provider actually has them (checked in the background each launch).
- Bigger channel logos in the guide; live progress shown inside every on-now programme; catch-up channels marked "↺ 3d" and past programmes "↺"; schedule only goes into the past on channels with catch-up.
- Guide is now the home screen (Settings > Guide, start screen, reminders > Start screen).  Tabs: Guide, Channels (was Live), Movies, Shows, Search, Settings.  Back from any other screen returns to the Guide.
- Guide: preview window top right.  OK on a channel previews it there, OK again goes fullscreen (or fullscreen at once, via a setting).  Back from fullscreen returns to the guide with the picture still in the window.
- Guide: two-line programme cells (title and time), details panel with a two-line description and a line saying what OK will do.
- Guide: group switcher above the channel column.  ▲ from the first channel focuses it, ◀ ▶ change group, OK lists all groups with counts.  Number keys jump to a channel number.
- Fullscreen: the info panel shows what every button does (follows remote remapping) and each item can be clicked.
- Magic Remote: hover to focus and click to select in every list, the guide grid, settings, menus, the setup screen, the hint bar and the fullscreen legend; wheel scrolls; clicking the preview window goes fullscreen.
- Playback: a channel that fails in one player no longer switches the whole provider to the TV player; each channel tries the built-in demuxer, the TV player and the provider's HLS version once each, then shows a clear message instead of eight reconnects.  Codec details are logged.
- Last channel (Yellow) can be pressed repeatedly; only the channel you stop on starts.
- Navigation: Back always climbs one level (channels, groups, menu bar, then Live); Left from the first column jumps to the menu bar on Live, Settings and Movies/Shows; menu bar tabs are clickable with a pointer; returning to Live restores the column you were in.
- Settings > Groups > Manage groups: every group with a Shown/Hidden switch, plus Show all / Hide all.
- Guide and Live never land on an empty group (an empty Favorites used to show a blank guide); empty groups say so.
- Development log file: with `npm run sim` or `npm run serve`, every log line plus key presses is written to logs/latest.log.  Key handler errors are now logged too.
- Setup: the field being typed in scrolls to the top so the on-screen keyboard no longer covers it.
- Setup: Show/Hide on the password field (Left/Right or click).
- Logs and Test connection describe the username/password shape (length, character types, stray spaces) without revealing them, to catch typos.

## 0.5.0 (2026-10-25)
- New app ID and service ID.  Installs as a new app; uninstall any 0.4.x first.
- Project restructured into a clean repo layout with build/install/inspect scripts.  About screen version now reads from one constant.

## 0.4.2
- http/https auto-detection, portless servers, wrong-scheme fallback, pasted get.php / player_api.php links fill in credentials.
- HTTPS (incl. self-signed) for the TV player and movies routed through the helper.

## 0.4.1
- Diagnostics: step-by-step Test connection, app log and helper log (credentials masked), detailed logging switch.
- Setup screen gets Network (Automatic/Direct), helper status, Test connection and View log.

## 0.4.0
- Bundled network helper service (localhost relay adding CORS headers).  Launch blocker fix: webOS enforces CORS on installed apps.
- Fixes: slow start when live buffer begins after zero; stuck pause after rejected play(); instant TV-player fallback for AC-3; keep playing buffered video when provider hangs up.

## 0.3.0
- Channel name editor rebuilt: per-playlist, preloaded default rules, "Enable recommended defaults", live preview.
- Remote remapping (short/long press, player and list contexts, learn a button, button tester).
- Per-playlist XMLTV sources with priority and offsets, name matching, manual guide assignment, refresh schedules.

## 0.2.0
- Catch-up, Movies/Shows, search, multiview, multiple playlists, favorites, recents, parental PIN, reminders, sleep timer, multi-select.
- Neutral app id (no personal domain).

## 0.1.0
- First build: Xtream + M3U, buffer profiles, stall watchdog, virtual lists, name cleanup, custom groups, hide/restore.
