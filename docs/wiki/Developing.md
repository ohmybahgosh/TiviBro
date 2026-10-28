TiviBro is plain HTML, CSS and JavaScript, with no bundler and no build step beyond packaging.  The same IPK runs from webOS 4 (Chromium 53) to webOS 26, with webOS 25 as the main target; see [compatibility](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/COMPATIBILITY.md).  A small webOS JS service acts as a localhost relay (CORS, custom User-Agent) and hosts the LAN web editor.

## Layout

```
app/              The webOS web app (what runs on the TV)
  appinfo.json    App manifest (id, version, icons, splash)
  js/             App modules (see docs/ARCHITECTURE.md)
  css/  img/      Styles, icons, splash and logo
  vendor/         hls.js (full build) and mpegts.js (small null-guard patch, see vendor/PATCHES.md)
service/          webOS JS service: localhost relay + LAN web editor (service/editor/)
tests/            Unit tests (Node), soak tests (Playwright), dev relay, mock provider
scripts/          build, install, launch, sim, inspect, serve, lint, release, demo, wiki
logos/            Brand artwork; logos/clean/ holds the cleaned, ready-to-use files
docs/             User guide, architecture, decisions, roadmap, simulator guide, TiviMate parity
```

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Package `app/` + `service/` into `dist/app.tivibro.tv_<ver>_all.ipk` and check its layout |
| `bash scripts/build.sh --dev` | Same, unminified, for readable DevTools |
| `npm run install:tv` | Install the built IPK on the TV (`-- -d <tv>` to pick one) |
| `npm run launch` | Launch TiviBro on the TV |
| `npm run sim` | Run the app in the LG webOS 25 Simulator, streaming logs to `logs/latest.log` |
| `npm run inspect` | DevTools for the app on the TV (`bash scripts/inspect.sh -s` for the service) |
| `npm run serve` | Run the app in a desktop browser at http://localhost:8078 with the dev relay |
| `npm run lint` | Syntax-check every JS and JSON file |
| `npm test` | Unit tests: compatibility, player (fake video and clock), TS resync, name cleaner, relay, web editor, library, updater |
| `npm run soak:chaos` | Plays every sloppy test stream in the real app and reports freezes, reconnects and time moving |
| `npm run soak:zap` | 300 fast channel changes, then checks playback, memory and that menus still open |
| `npm run soak:monkey` | Minutes of random remote presses across every screen, looking for errors and dead ends |

## Trying it without a provider

`tests/mock/mock_provider.js` is a fictional Xtream provider: 63 channels in 14 groups, a full XMLTV guide with catch-up, 12 movies and 6 shows.  Any username and password work.

```bash
bash scripts/demo/make-media.sh          # once: synthetic demo streams (needs ffmpeg)
node tests/mock/mock_provider.js &       # http://127.0.0.1:8077, login demo / demo
npm run serve                            # then add the playlist in the app
```

## Sloppy streams (soak tests)

The player is tuned against a mock provider that misbehaves on purpose.  With `MOCK_CHAOS=1` it adds a **TEST | Chaos** group, one channel per kind of bad stream:

| Channel | What it does |
|---|---|
| Slow Patches | Drops to a third of real time for 10s every 35s, then catches up |
| Stalls | No data for 8s every 30s, then a burst; one 20s stall |
| Drops | The connection is cut every 25 to 45 seconds |
| Busy | The first two connections are refused (503), later ones sometimes 403 |
| Jumps | Timestamps jump back or ahead every 30s, like an upstream restart |
| Garbage | Random bytes injected every 15 seconds |
| Slow Start | First byte after 8 seconds, then a slow trickle |
| Storm | Slow patches, garbage, a 12s stall and a dropped connection |
| Outage | Plays 30 seconds, then the provider answers 404 for 60 seconds, then comes back |
| Trickle | Never faster than 92% of real time, so the buffer always slowly drains |
| Restart | Switches to a differently encoded stream every 40 seconds |

```bash
bash scripts/demo/make-media.sh          # once: includes the 10-minute chaos.ts clip
MOCK_CHAOS=1 node tests/mock/mock_provider.js &
npm run serve &
npm run soak:chaos -- --secs 150         # or pick channels: npm run soak:chaos -- 906 909
```

Headless Chromium decodes in software, so compare runs with each other rather than with a TV.  `soak:zap` and `soak:monkey` use the same setup; the monkey is seeded (`--seeds 1,2,3`) so a failing run can be replayed.

## More

- [Architecture](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/ARCHITECTURE.md) and [decisions](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/DECISIONS.md)
- [Simulator guide](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/SIMULATOR.md)
- [webOS compatibility](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/COMPATIBILITY.md)
- [Roadmap](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/ROADMAP.md)
- [Recording the demo media](Recording-the-demo-media) and [Releasing](Releasing)
