# Roadmap and status

## Now: test in the webOS 25 Simulator (`npm run sim`, see SIMULATOR.md), then first install on the TV
- [ ] Install `releases/0.5.0/app.tivibro.tv_0.5.0_all.ipk` (or `npm run build && npm run install:tv`).
- [ ] Confirm Settings > Playback > Network helper says "running on port 47811".
- [ ] Run Test connection against the real XC provider; photo the result if anything fails.
- [ ] Check multiview decode limit (2 vs 4 tiles) on real hardware.

## Known gaps
- **Mock provider missing.**  The mock Xtream/XMLTV/HTTPS server used by `tests/e2e/*` and `tests/unit/proxy.test.js` lived only in the old chat sandbox and was not in the source zip.  Those suites expect it on 127.0.0.1:8077 (http) and :8443 (self-signed https), with 2000 channels, 3 live categories, `guide2.xml`, `/hls/`, `/redir.m3u8`, timeshift/movie paths and test users `goodu`, `bad`, `html`, `empty`, `full`.  Needs rebuilding into `tests/mock/`.
- Pointer: menu bar tabs and the password Show button are clickable; lists and menus are still arrows-only.
- tests/e2e were written before the Back/Left navigation changes and will need updating when the mock provider is rebuilt.
- Placeholder icons; real icon/logo pending (see `brand/icon-prompt.md`), plus a splash screen.

## Before public launch
- Backup/restore of settings and edits.
- "All playlists" combined view.
- Decide on `requiredACG` once webOS 26 enforcement applies (deliberately omitted for 25 and below).

## Not possible in a webOS web app
Recording to the TV, changing User-Agent, auto frame rate, Android-only player options.  Dispatcharr or another proxy covers recording and UA upstream.

## Deferred
- Stalker portal.
