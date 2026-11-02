# Roadmap and status

## Now: alpha testing on real TVs
- Alpha builds (0.6.0 alpha) are in daily use on real LG TVs: a C2 on webOS 25, an OLED65C9 on webOS 4, a 50NANO79 on webOS 5 and a 32LQ630B on webOS 22, plus the Android phone app.
- Problem reports come straight from the TVs (Settings > Diagnostics > Report a problem) and land in GitHub issues; fixes ship in the next alpha.
- Next: beta.

## Known gaps
- **Mock provider incomplete.**  `tests/mock/mock_provider.js` is now in the repo, but it is the demo provider: plain http on 127.0.0.1:8077, any login, about 60 made-up channels.  The original used by `tests/e2e/*` and `tests/unit/proxy.test.js` lived only in the old chat sandbox and was not in the source zip.  Those suites also expect :8443 (self-signed https), 2000 channels, 3 live categories, `guide2.xml`, `/hls/`, `/redir.m3u8`, timeshift/movie paths and test users `goodu`, `bad`, `html`, `empty`, `full`.  Until the mock covers that, CI runs the unit tests only and `npm run test:relay` and the e2e suites can't run.
- tests/e2e were written before the Back/Left navigation changes and will need updating when the mock provider is rebuilt.

## Before public launch
- ~~Make the repo public~~ (done; Homebrew Channel repository on the `homebrew` branch, address in the README).
- "All playlists" combined view.
- Decide on `requiredACG` once webOS 26 enforcement applies (deliberately omitted for 25 and below).

## Done since 0.5.0 (see CHANGELOG)
- Magic Remote: hover and click in every list, menu, the guide grid and settings; wheel scrolls.
- Real logo: app icons, splash screen and wordmark.
- Backup/restore of settings, playlists and edits, locked with a passphrase.
- Custom User-Agent per playlist, sent by the network helper (no longer needs a proxy upstream).

## Not possible in a webOS web app
Recording to the TV, auto frame rate, Android-only player options, multiview (an app plays one video at a time; removed in alpha 24).  Dispatcharr or another proxy covers recording upstream.

## Deferred
- Stalker portal.
- Multiview, someday: the TV's own Multi View pairs an app with an HDMI input, so look at whether a second source could be offered to it as an input.  Research only.
