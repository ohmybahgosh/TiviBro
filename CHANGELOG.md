# Changelog

## Unreleased
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
