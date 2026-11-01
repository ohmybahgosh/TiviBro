# Architecture

Plain scripts loaded in order by `app/index.html` (no modules, no bundler: webOS blocks module scripts under `file://`).  Each file exposes one global.

| File | Global | Role |
|---|---|---|
| util.js | `U` | DOM helpers, keys, fetch with timeout |
| log.js | `Log`, `TIVIBRO_VERSION` | Ring-buffer log, persisted, credentials redacted.  **Version constant lives here** |
| net.js | `Net` | Starts the helper service, rewrites provider URLs through it (Automatic/Direct) |
| keymap.js | `Keymap` | Remote remapping: player/list contexts, short/long press, learned keys |
| store.js | `Store` | Settings in localStorage; the playlist on the helper's storage (`bigGet`/`bigSet`, IndexedDB without the helper); multi-playlist, migrations |
| names.js | `Names` | Channel/group name cleaner: default rule packs + TiviMate-style prefix/suffix lists |
| source.js | `Source` | Xtream Codes + M3U loading, http/https detection, catch-up URLs |
| library.js | `Library` | Provider data + user overlays (hide, rename, custom groups, favorites, sorting) |
| parental.js | `Parental` | 4-digit PIN for channels/groups/settings |
| epg.js | `Epg` | XMLTV per playlist (worker parsed), short EPG fallback, name matching, assignment |
| pubepg.js | `PubEpg` | Public guide fill-in: sources (epg.pw, iptv-epg.org), countries, matching keys (also run in the guide worker); `Epg` runs it as a second pass for channels with no guide |
| caps.js | `Caps` | What the TV decodes (MSE vs TV player, plus known LG rules such as no DTS on 2020-2022 models), stream descriptions from HLS / mpegts.js / Xtream, and pipeline routing for HDR, Dolby Vision and codecs |
| player.js | `Player` | mpegts.js / hls.js / TV player engines, buffer profiles, a cushion that grows on unsteady streams, a start check every 50ms until the first frame, timestamp-jump following, starvation detection, watchdog, reconnect ladder (backoff with jitter, offline wait, other pipelines, slow retry), resume, live pause, suspend/resume |
| vlist.js | `VList` | Virtual list with pooled rows |
| ui.js | `UI` | Key routing, long-press, modal menus, prompts |
| views.js | `Views` | Live list, fullscreen + OSD, guide grid, menus |
| search.js | `Search` | Search across channels, the guide, movies and shows, ranked by match |
| vod.js | `Vod` | Movies and Shows: lists (kept and filtered by the helper's `service/vod.js` on a TV), languages, hidden and adult categories, details, playback and resume |
| vodview.js | `VodView` | Movie and show language tags and what shows; shared with the helper (`service/editor/vodview.js` is a build copy) |
| mkvsubs.js | `MkvSubs` | Reads SRT subtitles out of MKV files over Range requests for the TV's own player |
| links.js | `Links` | Splits a provider's full link into server, username and password (shared with the editor) |
| events.js | `Events` | Event channels: the game in a pay-per-view or sports-pass channel name, as a guide entry |
| tidy.js | `Tidy` | Smart clean-up answers (countries, East and West, locals, duplicates), shared with the editor |
| tour.js | `Tour` | The set-up tour after a new playlist |
| logos.js | `Logos` | Logos from open logo projects for channels without one |
| remind.js / watch.js | `Remind`, `Watch` | Reminders (handed to the helper so they work with TiviBro closed) and the watchlist |
| update.js | `Update` | Checks for new releases, installs through the Homebrew Channel, the anonymous daily count |
| phone.js | `Phone` | The phone app from TiviBro's side: pairing screens, remote commands, state and lineup for the phone |
| webedit.js | `WebEdit`, `Backup` | The web editor from TiviBro's side: snapshots, applying saves, the `RUN` command table, backups |
| settings.js | `Settings` | All settings pages |
| diag.js | `Diag` | Test connection + log viewer |
| app.js | `App` | Boot: paint cache, resume, background refresh |

## Network helper (`service/`)

Files: `service.js` (the webOS service: start subscription, wake activity), `proxy.js` (the relay and its routes), `guide.js` (big guides), `vod.js` (keeps movie and show lists), `kv.js` (keeps the playlist), `editor.js` (the web editor's LAN server), `companion.js` (the phone app's LAN API on 47810 and UDP discovery), `remind.js` (reminders with TiviBro closed), `rawhttp.js`, `tssync.js`, `unzip.js`, `compat.js`.

webOS enforces CORS for installed apps and most providers send no CORS headers.  `service.js` wraps `proxy.js`, a localhost relay on **127.0.0.1:47811** using path-style URLs: `/x/<scheme>/<host[:port]>/<path>`.  It adds CORS headers, rewrites redirects, passes Range through, accepts self-signed certs, exposes `/ping` and `/log`.  It keeps provider connections alive between requests and remembers DNS answers for a minute, so channel changes don't wait on the TV's resolver.  When Node's HTTP parser refuses a provider's reply (stray control characters, `Content-Length` twice), the request is repeated through `rawhttp.js`, a small forgiving HTTP/1.x reader.  Live MPEG-TS passes through `tssync.js`, which drops stray bytes and keeps 188-byte packets aligned, so a corrupted stretch costs a glitch instead of a stalled demuxer.  The app keeps a `start` subscription open; when the app closes the service exits.

**Big guides (`guide.js`).**  With the helper running, XMLTV guides are read by the helper, not the app: webOS closes an app at about 500 MB, and a full guide parsed in the app can pass that (a 64 MB iptv-epg.org file did on a 2 GB C2).  The app posts what to keep (`POST /guide/load`: sources as relay addresses with `/unz/<id>`, wanted guide ids, name matches, the public guide's matching keys) and follows `GET /guide/status`.  The helper streams each file through its own relay, keeps the playlist's channels inside the time window (same rules as the in-app worker), spills programmes to bucket files, then writes per playlist and kind (`main`, `pub`) `titles.tsv` (start, end, title), `desc.json` with `desc.idx` (one channel's descriptions by offset) and `meta.json` (guide channel list, icons, name matches, report).  It keeps the old guide when every file fails, and stores under the service folder on the TV's storage (falls back to `/tmp`).  The app holds only titles and times (`Epg.request`, search, the watchlist, the grid) and asks `GET /guide/desc` when a description is shown (`Epg.desc`, last 80 channels kept).  A restart reads what is stored, with no download.  Without the helper the worker in `epg.js` does it all, within a memory budget.  `service/editor/pubepg.js` is a build copy of `app/js/pubepg.js` (lint checks it).

**Movie and show lists (`vod.js`) and the playlist (`kv.js`).**  An old TV gives the web app only a small share of its storage (issue #18: a 51,000-channel list and its movie lists did not fit a 2019 C9), so with the helper running both live on the TV's storage: `/media/internal/.tivibro` when the helper can write there (kept across updates), else beside the guide.  `POST /vod/list` downloads and slims a list once, keeps it (`vod/<playlist>-<kind>.json`, and in the helper's memory for 3 minutes), and answers with only what shows: the languages picked and no hidden categories, using `VodView` like the app.  A language or category change asks again; the app never holds every language.  `GET/POST /kv/get|put|del?k=` keep the playlist (`Store.bigGet`/`bigSet`); they need TiviBro's secret like `/editor/` (the playlist holds stream addresses with the login).  A copy left in IndexedDB by an older TiviBro is moved over once.  Without the helper (a browser) both stay in IndexedDB, and a save that runs out of space frees other playlists' caches and tries again.

Video handed to the TV's native player goes direct for http, through the helper for https.

## Storage keys
`tivibro.settings`, `tivibro.edits.<playlistId>`, `tivibro.devRelay` (desktop testing only), IndexedDB `tivibro`, and on a TV the helper's `kv/` and `vod/` folders.

## Web editor ("Edit on a phone or computer")
- `service/editor.js`: LAN HTTP server (0.0.0.0:<port>, only while switched on) serving `service/editor/index.html` + `names.js` (copied from `app/js/names.js` by the build; lint checks it is current).  Browser API: `POST /api/login`, `GET /api/state`, `GET /api/rev`, `POST /api/save`, `POST /api/logout`, token in `X-Token`.
- Control from the app over the localhost relay: `POST /editor/start {port,password}`, `/editor/stop`, `GET /editor/status`, `POST /editor/snapshot`, `GET /editor/pending?since=N`.
- `app/js/webedit.js`: starts/stops it, sends snapshots (group/channel names, logos, edits, name rules; never credentials or stream URLs), polls every 2 s and applies browser saves to `hiddenGroups`, `hiddenChannels`, `renames`, `custom`, `groupOrder` and the playlist's name rules.
- Actions (playlists, guide sources, backup, restore): browser `POST /api/command {type,args}` → app picks them up from `/editor/pending` (`commands`), runs them (`WebEdit` RUN table), answers via `POST /editor/result`; browser polls `GET /api/result?id=`.  Backups are created and restored by `Backup` in `app/js/webedit.js`; restore freezes Store saves, writes localStorage and reloads, and `WebEdit.resume()` picks the running editor back up.
- Desktop testing: `npm run serve`, set `tivibro.devRelay`, switch it on in Settings, open http://localhost:8787.

### Editor model (v2)
- The browser holds a working copy of the edits (E) and name rules (N).  Every change goes through `mut(label, fn)`, which records an undo step, saves the draft in localStorage (`tivibro.editor.draft.<playlist>`) and updates the change bar.  `send()` posts the whole copy to `/api/save` and waits for `appliedRev`.
- Edits the TV understands: hiddenGroups, hiddenChannels, renames, groupRenames, custom (with optional `orig` name), groupOrder, epgMap, groupAdd {group: [keys]}, groupRemove {group: {key: 1}}, groupSort {group: provider|az|za|number|custom}.  `Library.channels()` applies groupAdd/groupRemove/groupSort.
- Restore points: `WebEdit` keeps them in IndexedDB under `snaps:<playlist id>`; an automatic one is taken before each browser save is applied.
- Guide progress: the XMLTV worker posts `{progress}` messages while it reads; `Epg.onProgress` drives the TV chip (`#epgProg`) and `WebEdit` relays it to `/editor/progress` (throttled to about one a second).  Guide commands start the load and answer straight away.
- Smart match runs in the browser against `guide.channels` from the snapshot (inverted token index, bigram similarity, country, East/West, number and call-sign rules).
