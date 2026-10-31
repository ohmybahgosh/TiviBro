# Architecture

Plain scripts loaded in order by `app/index.html` (no modules, no bundler: webOS blocks module scripts under `file://`).  Each file exposes one global.

| File | Global | Role |
|---|---|---|
| util.js | `U` | DOM helpers, keys, fetch with timeout |
| log.js | `Log`, `TIVIBRO_VERSION` | Ring-buffer log, persisted, credentials redacted.  **Version constant lives here** |
| net.js | `Net` | Starts the helper service, rewrites provider URLs through it (Automatic/Direct) |
| keymap.js | `Keymap` | Remote remapping: player/list contexts, short/long press, learned keys |
| store.js | `Store` | Settings in localStorage, big lists in IndexedDB, multi-playlist, migrations |
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
| search.js / vod.js | | Search, Movies/Shows |
| settings.js | `Settings` | All settings pages |
| diag.js | `Diag` | Test connection + log viewer |
| app.js | `App` | Boot: paint cache, resume, background refresh |

## Network helper (`service/`)
webOS enforces CORS for installed apps and most providers send no CORS headers.  `service.js` wraps `proxy.js`, a localhost relay on **127.0.0.1:47811** using path-style URLs: `/x/<scheme>/<host[:port]>/<path>`.  It adds CORS headers, rewrites redirects, passes Range through, accepts self-signed certs, exposes `/ping` and `/log`.  It keeps provider connections alive between requests and remembers DNS answers for a minute, so channel changes don't wait on the TV's resolver.  When Node's HTTP parser refuses a provider's reply (stray control characters, `Content-Length` twice), the request is repeated through `rawhttp.js`, a small forgiving HTTP/1.x reader.  Live MPEG-TS passes through `tssync.js`, which drops stray bytes and keeps 188-byte packets aligned, so a corrupted stretch costs a glitch instead of a stalled demuxer.  The app keeps a `start` subscription open; when the app closes the service exits.

Video handed to the TV's native player goes direct for http, through the helper for https.

## Storage keys
`tivibro.settings`, `tivibro.edits.<playlistId>`, `tivibro.devRelay` (desktop testing only), IndexedDB `tivibro`.

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
