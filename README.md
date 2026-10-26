<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logos/clean/tivibro-wordmark.png">
    <img alt="tiviBro" src="logos/clean/tivibro-wordmark-on-light.png" width="460">
  </picture>
</p>

<p align="center">
  <b>The IPTV player LG TVs never got.</b><br>
  A free, guide-first IPTV player for LG webOS, built to feel like TiviMate and go further.
</p>

<p align="center">
  <img alt="Platform: LG webOS" src="https://img.shields.io/badge/platform-LG%20webOS%206%2B-5B8CFF?style=flat-square">
  <img alt="Version" src="https://img.shields.io/badge/version-0.5.0%20beta-33E1FF?style=flat-square">
  <img alt="Price: free" src="https://img.shields.io/badge/price-free-3DDC97?style=flat-square">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-8F9BBF?style=flat-square">
  <img alt="No bundler" src="https://img.shields.io/badge/plain-HTML%20%2F%20JS-141A2E?style=flat-square">
</p>

---

TiviBro plays your own IPTV subscription (Xtream Codes or M3U with XMLTV) on LG webOS TVs.  The guide is the home screen, the Magic Remote works everywhere, and a companion web editor lets you clean up hundreds of groups from your computer instead of with a TV remote.

> **TiviBro does not provide any channels, streams or playlists.**  You bring your own legal subscription.

> **Status: beta.**  Everything here runs in the webOS 25 Simulator and in desktop test harnesses.  Real-TV testing is under way, so expect rough edges.

## Highlights

### On the TV

- **Guide-first home screen.**  A live preview sits top left with programme details top right.  OK previews a channel, OK again (or Play) goes fullscreen.  Group switching sits right beside the guide.
- **TiviMate-style quick menu.**  OK during playback opens actions and recent channels; you pick which buttons it shows.
- **Catch-up where your provider supports it,** with markers in the guide and on channels, plus restart-from-start and rewind.
- **Smart playback.**  Engines are picked per stream (MPEG-TS, native, HLS) with automatic fallback, adaptive buffering, quality, speed, subtitles, picture size per channel, and multiview.
- **Magic Remote everywhere.**  Point, click and scroll work on every screen, and a colour-button legend shows what each key does.
- **Hours of TiviMate parity.**  A channel-name cleaner, custom groups, favorites, hide and restore, reminders, parental controls, a sleep timer, remote remapping and on-TV diagnostics.  See [`docs/TIVIMATE-PARITY.md`](docs/TIVIMATE-PARITY.md).
- **Midnight Electric look,** with other backgrounds and accent colours to choose from.

### From your computer: the web editor

Turn on **Settings > Edit on a computer**.  The TV shows an address and a one-time password.  Open the address in any browser on your network.

- **Drafts, undo and restore points.**  Nothing reaches the TV until you press **Send to TV**.  Every change can be undone, and the TV keeps restore points.
- **Copy or move channels into any group,** including your provider's groups.  Each group can have its own sort order.
- **Smart clean-up.**  Keep only the countries you watch, hide duplicate channels in different qualities, hide by keyword, and hide empty groups.
- **Smart match** finds the right guide channel for channels showing "No guide information".  You approve or decline each guess.
- **Live guide download progress** on big XMLTV files: speed, percent and time left, on the computer and on the TV.
- **Recommended free guide sources** by region, each with a one-click **Test**.
- **Full, encrypted backups.**  Playlists, logins, groups, favorites and settings go into one file, locked with your passphrase (AES-256-GCM) before it leaves the TV.  Restore it onto a brand-new TV straight from the first-run screen.

<p align="center">
  <img alt="Web editor overview" src="docs/screenshots/editor-overview.png" width="49%">
  <img alt="Copy or move channels into any group" src="docs/screenshots/editor-copy-move.png" width="49%">
  <img alt="Smart match for the guide" src="docs/screenshots/editor-smart-match.png" width="49%">
  <img alt="Live guide download progress" src="docs/screenshots/editor-guide-progress.png" width="49%">
  <img alt="Smart clean-up" src="docs/screenshots/editor-smart-cleanup.png" width="49%">
  <img alt="Encrypted backups" src="docs/screenshots/editor-backup.png" width="49%">
</p>

<sub>Screenshots use a made-up test playlist.</sub>

## Install

### Homebrew Channel (coming soon)

TiviBro will be published as a custom repository for the [webOS Homebrew Channel](https://www.webosbrew.org/), and later submitted to the official store.  The repository address will appear here with the first public release.

### Developer Mode (works today)

1. Put your TV in [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) or use a rooted TV.
2. Build and install from this repository:

```bash
npm install                    # installs the webOS CLI (ares-*) locally
npx ares-setup-device          # add your TV (IP, port 9922)
npm run build                  # dist/app.tivibro.tv_<version>_all.ipk
npm run install:tv             # install on the TV
npm run launch
```

### Moving from another TV

On the old TV, open the web editor, then **Backup and restore > Download locked backup**.  On the new TV, choose **Set up or restore from a computer** on the first screen and restore the file with its passphrase.

## Develop

TiviBro is plain HTML, CSS and JavaScript (ES2018 for Chromium 79+), with no bundler and no build step beyond packaging.  A small webOS JS service acts as a localhost relay (CORS, custom User-Agent) and hosts the LAN web editor.

```
app/              The webOS web app (what runs on the TV)
  appinfo.json    App manifest (id, version, icons, splash)
  js/             App modules (see docs/ARCHITECTURE.md)
  css/  img/      Styles, icons, splash and logo
  vendor/         hls.js (light) and mpegts.js, unmodified
service/          webOS JS service: localhost relay + LAN web editor (service/editor/)
tests/            Unit tests (Node), Playwright suites, dev relay
scripts/          build, install, launch, sim, inspect, serve, lint, bump-version
logos/            Brand artwork; logos/clean/ holds the cleaned, ready-to-use files
docs/             Architecture, decisions, roadmap, simulator guide, TiviMate parity
```

| Command | What it does |
|---|---|
| `npm run build` | Package `app/` + `service/` into `dist/app.tivibro.tv_<ver>_all.ipk` and check its layout |
| `bash scripts/build.sh --dev` | Same, unminified, for readable DevTools |
| `npm run install:tv` | Install the built IPK on the TV (`-- -d <tv>` to pick one) |
| `npm run launch` | Launch TiviBro on the TV |
| `npm run sim` | Run the app in the LG webOS 25 Simulator, streaming logs to `logs/latest.log` (see [`docs/SIMULATOR.md`](docs/SIMULATOR.md)) |
| `npm run inspect` | DevTools for the app on the TV (`bash scripts/inspect.sh -s` for the service) |
| `npm run serve` | Run the app in a desktop browser at http://localhost:8078 with the dev relay |
| `npm run lint` | Syntax-check every JS and JSON file |
| `npm test` | Unit tests: name cleaner, relay, web editor (including encrypted backups), library |
| `bash scripts/bump-version.sh X.Y.Z` | Set the version everywhere it appears |

### Releasing

Releases are built by GitHub Actions.  Every push and pull request also runs lint, tests and a test build ([CI](.github/workflows/ci.yml)).

1. `bash scripts/bump-version.sh X.Y.Z`
2. In [`CHANGELOG.md`](CHANGELOG.md), rename `## Unreleased` to `## X.Y.Z (date)`, then commit.
3. `npm run release`.  It checks everything locally, then tags `vX.Y.Z` and pushes the tag.

The [Release workflow](.github/workflows/release.yml) then runs the tests, builds the IPK, writes the Homebrew Channel manifest and `repo.json`, and publishes a GitHub release with the CHANGELOG section as its notes.  Tags with a dash (`v0.6.0-beta.1`) become pre-releases.

## Privacy and security

- Provider logins stay on the TV.  The web editor only ever sees server names, never usernames, passwords or stream links.
- The web editor is off at every start, needs the password shown on the TV, and locks out after repeated wrong tries.
- Backups are always encrypted with a passphrase you choose.  Without it the file cannot be opened.
- Logs mask usernames and passwords.

## Credits

Made by **[OhMyBahGosh](https://github.com/ohmybahgosh)**.

Playback uses [hls.js](https://github.com/video-dev/hls.js) and [mpegts.js](https://github.com/xqq/mpegts.js).  Thanks to the [webOS Homebrew](https://www.webosbrew.org/) community.

TiviBro is an independent project.  It is not affiliated with LG Electronics or with TiviMate; those names belong to their owners.

## License

[MIT](LICENSE)
