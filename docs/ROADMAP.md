# Roadmap and status

## Now: first install on the TV (the app already runs in the webOS 25 Simulator, `npm run sim`, see SIMULATOR.md)
- [ ] Install `dist/app.tivibro.tv_0.5.0_all.ipk` with `npm run install:tv` (it builds the IPK first if `dist/` is empty).
- [ ] Confirm Settings > Playback > Network helper says "running on port 47811".
- [ ] Run Test connection against the real XC provider; photo the result if anything fails.
- [ ] Check multiview decode limit (2 vs 4 tiles) on real hardware.

## Known gaps
- **Mock provider incomplete.**  `tests/mock/mock_provider.js` is now in the repo, but it is the demo provider: plain http on 127.0.0.1:8077, any login, about 60 made-up channels.  The original used by `tests/e2e/*` and `tests/unit/proxy.test.js` lived only in the old chat sandbox and was not in the source zip.  Those suites also expect :8443 (self-signed https), 2000 channels, 3 live categories, `guide2.xml`, `/hls/`, `/redir.m3u8`, timeshift/movie paths and test users `goodu`, `bad`, `html`, `empty`, `full`.  Until the mock covers that, CI runs the unit tests only and `npm run test:relay` and the e2e suites can't run.
- tests/e2e were written before the Back/Left navigation changes and will need updating when the mock provider is rebuilt.

## Before public launch
- Make the repo public: release files of a private repo need a GitHub login, so the Homebrew Channel can't fetch `repo.json` yet.  Then put its address in the README.
- "All playlists" combined view.
- Decide on `requiredACG` once webOS 26 enforcement applies (deliberately omitted for 25 and below).

## Done since 0.5.0 (see CHANGELOG)
- Magic Remote: hover and click in every list, menu, the guide grid and settings; wheel scrolls.
- Real logo: app icons, splash screen and wordmark.
- Backup/restore of settings, playlists and edits, locked with a passphrase.
- Custom User-Agent per playlist, sent by the network helper (no longer needs a proxy upstream).

## Not possible in a webOS web app
Recording to the TV, auto frame rate, Android-only player options.  Dispatcharr or another proxy covers recording upstream.

## Deferred
- Stalker portal.
