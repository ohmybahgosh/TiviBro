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

<p align="center">
  <a href="#see-it-in-action">See it in action</a> ·
  <a href="#the-web-editor">Web editor</a> ·
  <a href="#gallery">Gallery</a> ·
  <a href="#install">Install</a> ·
  <a href="docs/USER-GUIDE.md"><b>User guide</b></a> ·
  <a href="../../wiki">Wiki</a> ·
  <a href="#develop">Develop</a>
</p>

<p align="center"><a href="docs/media/guide.mp4"><img src="docs/media/guide.gif" width="100%" alt="The TiviBro guide, preview and fullscreen"></a></p>
<p align="center"><sub>The guide is home: browse, preview in the window, OK again for fullscreen.  <a href="docs/media/guide.mp4">Watch the full-quality MP4</a>.  Every picture here is clickable.</sub></p>

TiviBro plays your own IPTV subscription (Xtream Codes or M3U with XMLTV) on LG webOS TVs.  The guide is the home screen, the Magic Remote works everywhere, and a companion web editor lets you clean up hundreds of groups from your computer instead of with a TV remote.

> **TiviBro does not provide any channels, streams or playlists.**  You bring your own legal subscription.

> **Status: beta.**  Everything here runs in the webOS 25 Simulator and in desktop test harnesses.  Real-TV testing is under way, so expect rough edges.

## Why TiviBro

| | |
|---|---|
| 📺 **Guide first** | Live preview top left, details top right, groups one press away.  OK previews, OK again goes fullscreen, just like TiviMate. |
| ⏪ **Catch-up done right** | Rewind the guide into the past and replay what you missed, or restart the show you just tuned into. |
| 🎬 **Movies and shows** | Your provider's VOD with posters, seasons, episodes, My list and resume. |
| 🧩 **Multiview** | Two channels side by side (four on TVs that can take it). |
| 🖥️ **A real editor** | Hide, sort, rename, copy and match guides for hundreds of channels from any browser.  Drafts, undo and restore points. |
| 🔒 **Locked backups** | Everything in one AES-256-GCM file.  Restore onto a brand-new TV straight from the first screen. |
| 🎨 **Midnight Electric** | A dark, calm look with accent colours and backgrounds to choose from, including true black for OLED. |
| 💸 **Free and open** | MIT licensed, no accounts, no ads, no tracking. |

## See it in action

<sub>All recordings use a made-up demo provider.  The pill in the top right shows which remote button was pressed.</sub>

<table>
<tr>
<td width="58%"><a href="docs/media/zap.mp4"><img src="docs/media/zap.gif" width="100%" alt="Changing channels and the quick menu"></a><br><sub><a href="docs/media/zap.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### Zap like cable TV

**▲ ▼** or **CH +/−** to change channel, **▶** for programme info, **Yellow** for the last channel, **Green** for the guide over the video.

**OK** opens the quick menu: channel list, start over, favorite, picture size, multiview, sleep timer, stream info, reconnect.  You choose which buttons it shows.

</td>
</tr>
</table>
<table>
<tr>
<td width="42%" valign="top">

### Catch-up

Press **⏪** in the guide to travel back in time.  Programmes marked **↺** replay from the start with one press.

**Hold OK** on any programme for more: watch fullscreen, earlier programmes by day, reminders, channel options.

</td>
<td width="58%"><a href="docs/media/catchup.mp4"><img src="docs/media/catchup.gif" width="100%" alt="Replaying a programme with catch-up"></a><br><sub><a href="docs/media/catchup.mp4">▶ MP4</a></sub></td>
</tr>
</table>
<table>
<tr>
<td width="58%"><a href="docs/media/groups.mp4"><img src="docs/media/groups.gif" width="100%" alt="Groups and the menu"></a><br><sub><a href="docs/media/groups.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### Groups beside the guide

Favorites and your own groups come first, then your provider's.  Moving through the list updates the guide behind it.

**◀** once more opens the menu: Guide, Channels, Movies, Shows, Search, Settings.

</td>
</tr>
</table>
<table>
<tr>
<td width="42%" valign="top">

### Movies and shows

Categories, posters, ratings and plots.  Shows open into seasons and episodes, and TiviBro remembers where you stopped.

</td>
<td width="58%"><a href="docs/media/vod.mp4"><img src="docs/media/vod.gif" width="100%" alt="Movies and shows"></a><br><sub><a href="docs/media/vod.mp4">▶ MP4</a></sub></td>
</tr>
</table>
<table>
<tr>
<td width="58%"><a href="docs/media/search.mp4"><img src="docs/media/search.gif" width="100%" alt="Search"></a><br><sub><a href="docs/media/search.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### Search everything

Channels, programmes now and later, catch-up, movies and shows, as you type.  OK watches, replays or sets a reminder.

</td>
</tr>
</table>
<table>
<tr>
<td width="42%" valign="top">

### Multiview

**Blue** puts a second channel beside the first.  The focused screen has the sound; **OK** takes it fullscreen.

</td>
<td width="58%"><a href="docs/media/multiview.mp4"><img src="docs/media/multiview.gif" width="100%" alt="Multiview"></a><br><sub><a href="docs/media/multiview.mp4">▶ MP4</a></sub></td>
</tr>
</table>
<table>
<tr>
<td width="58%"><a href="docs/media/settings.mp4"><img src="docs/media/settings.gif" width="100%" alt="Settings and appearance"></a><br><sub><a href="docs/media/settings.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### Make it yours

Accent colours, four backgrounds (Midnight, Black OLED, Slate, Classic), text size, panel transparency, clock, logos and more, all live.

Plus remote remapping, parental controls, reminders, buffering profiles and on-TV diagnostics.

</td>
</tr>
</table>

## The web editor

Turn on **Settings > Edit on a computer**.  The TV shows an address and a password; open it in any browser on your network.  Changes are drafts until you press **Send to TV**, and the TV picks them up in seconds.

<p align="center"><a href="docs/media/live-edit.mp4"><img src="docs/media/live-edit.gif" width="100%" alt="Hiding groups in the editor while the TV follows"></a></p>
<p align="center"><sub>Switching off the UK, FR and DE groups on the computer, then sending: the TV's group list updates by itself.  <a href="docs/media/live-edit.mp4">MP4</a></sub></p>

- **Drafts, undo and restore points.**  Nothing reaches the TV until you press **Send to TV**.  Every change can be undone, and the TV keeps restore points.
- **Copy or move channels into any group,** including your provider's groups.  Each group can have its own sort order.
- **Smart clean-up.**  Keep only the countries you watch, hide duplicate channels in different qualities, hide by keyword, and hide empty groups.
- **Smart match** finds the right guide channel for channels showing "No guide information".  You approve or decline each guess.
- **Live guide download progress** on big XMLTV files: speed, percent and time left, on the computer and on the TV.
- **Recommended free guide sources** by region, each with a one-click **Test**.
- **Logins never leave the TV.**  The editor only ever sees server names.

<p align="center">
  <a href="docs/screenshots/editor-overview.png"><img src="docs/screenshots/editor-overview.png" width="49%" alt="Editor overview"></a>
  <a href="docs/screenshots/editor-copy-move.png"><img src="docs/screenshots/editor-copy-move.png" width="49%" alt="Copy or move channels"></a>
  <a href="docs/screenshots/editor-smart-match.png"><img src="docs/screenshots/editor-smart-match.png" width="49%" alt="Smart match"></a>
  <a href="docs/screenshots/editor-smart-cleanup.png"><img src="docs/screenshots/editor-smart-cleanup.png" width="49%" alt="Smart clean-up"></a>
</p>

### New TV?  Restore everything in a minute

A backup holds every playlist with its login, your groups, favorites, names, guide matches and settings, locked with your passphrase (AES-256-GCM) before it leaves the TV.  On a brand-new install, choose **Set up or restore from a computer** on the very first screen:

<p align="center"><a href="docs/media/restore.mp4"><img src="docs/media/restore.gif" width="100%" alt="Restoring a locked backup onto a brand-new TV"></a></p>
<p align="center"><sub>Fresh install, password from the TV, drop the file, unlock, restore.  TiviBro restarts with everything back.  <a href="docs/media/restore.mp4">MP4</a></sub></p>

## Gallery

<sub>Click any screenshot to open it full size.</sub>

<details open>
<summary><b>Guide and live TV</b></summary>
<p align="center">
  <a href="docs/screenshots/tv-guide.png"><img src="docs/screenshots/tv-guide.png" width="32%" alt="Guide"></a>
  <a href="docs/screenshots/tv-guide-preview.png"><img src="docs/screenshots/tv-guide-preview.png" width="32%" alt="Preview in the window"></a>
  <a href="docs/screenshots/tv-groups.png"><img src="docs/screenshots/tv-groups.png" width="32%" alt="Groups beside the guide"></a>
  <a href="docs/screenshots/tv-fullscreen.png"><img src="docs/screenshots/tv-fullscreen.png" width="32%" alt="Fullscreen with the info bar"></a>
  <a href="docs/screenshots/tv-quick-menu.png"><img src="docs/screenshots/tv-quick-menu.png" width="32%" alt="Quick menu"></a>
  <a href="docs/screenshots/tv-mini-guide.png"><img src="docs/screenshots/tv-mini-guide.png" width="32%" alt="Guide over the video"></a>
</p>
</details>

<details>
<summary><b>Catch-up, search and multiview</b></summary>
<p align="center">
  <a href="docs/screenshots/tv-catchup-guide.png"><img src="docs/screenshots/tv-catchup-guide.png" width="32%" alt="Past programmes in the guide"></a>
  <a href="docs/screenshots/tv-hold-menu.png"><img src="docs/screenshots/tv-hold-menu.png" width="32%" alt="Programme options"></a>
  <a href="docs/screenshots/tv-catchup-play.png"><img src="docs/screenshots/tv-catchup-play.png" width="32%" alt="Catch-up playing"></a>
  <a href="docs/screenshots/tv-search.png"><img src="docs/screenshots/tv-search.png" width="32%" alt="Search"></a>
  <a href="docs/screenshots/tv-multiview.png"><img src="docs/screenshots/tv-multiview.png" width="32%" alt="Multiview"></a>
  <a href="docs/screenshots/tv-menu.png"><img src="docs/screenshots/tv-menu.png" width="32%" alt="Menu"></a>
</p>
</details>

<details>
<summary><b>Movies, shows and settings</b></summary>
<p align="center">
  <a href="docs/screenshots/tv-movies.png"><img src="docs/screenshots/tv-movies.png" width="32%" alt="Movies"></a>
  <a href="docs/screenshots/tv-episodes.png"><img src="docs/screenshots/tv-episodes.png" width="32%" alt="Episodes"></a>
  <a href="docs/screenshots/tv-settings.png"><img src="docs/screenshots/tv-settings.png" width="32%" alt="Settings"></a>
  <a href="docs/screenshots/tv-settings-look.png"><img src="docs/screenshots/tv-settings-look.png" width="32%" alt="Appearance"></a>
  <a href="docs/screenshots/tv-first-run.png"><img src="docs/screenshots/tv-first-run.png" width="32%" alt="First start"></a>
  <a href="docs/screenshots/tv-first-run-remote.png"><img src="docs/screenshots/tv-first-run-remote.png" width="32%" alt="Set up from a computer"></a>
</p>
</details>

<details>
<summary><b>Web editor</b></summary>
<p align="center">
  <a href="docs/screenshots/editor-overview.png"><img src="docs/screenshots/editor-overview.png" width="49%" alt="Overview"></a>
  <a href="docs/screenshots/editor-copy-move.png"><img src="docs/screenshots/editor-copy-move.png" width="49%" alt="Copy or move"></a>
  <a href="docs/screenshots/editor-guide-progress.png"><img src="docs/screenshots/editor-guide-progress.png" width="49%" alt="Guide download progress"></a>
  <a href="docs/screenshots/editor-smart-match.png"><img src="docs/screenshots/editor-smart-match.png" width="49%" alt="Smart match"></a>
  <a href="docs/screenshots/editor-smart-cleanup.png"><img src="docs/screenshots/editor-smart-cleanup.png" width="49%" alt="Smart clean-up"></a>
  <a href="docs/screenshots/editor-backup.png"><img src="docs/screenshots/editor-backup.png" width="49%" alt="Backup and restore"></a>
</p>
</details>

## Help

The **[user guide](docs/USER-GUIDE.md)** (also on the [wiki](../../wiki)) covers everything: every remote button, the guide, catch-up, movies and shows, multiview, every settings section, parental controls, each page of the web editor, backups, and troubleshooting.

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

### Demo media

Every GIF, video and TV screenshot in this README and the [user guide](docs/USER-GUIDE.md) is recorded from the real app against a made-up provider, so they can be refreshed after any UI change:

```bash
bash scripts/demo/make-media.sh          # once: synthetic demo streams (needs ffmpeg)
node tests/mock/mock_provider.js &       # fictional Xtream provider on :8077
npm run serve                            # app on :8078 plus the dev relay
node scripts/demo/record.js              # record every scene (or name some: guide zap)
bash scripts/demo/encode.sh              # GIFs and MP4s into docs/media/
```

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
