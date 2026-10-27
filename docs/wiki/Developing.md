TiviBro is plain HTML, CSS and JavaScript (ES2018 for Chromium 79+), with no bundler and no build step beyond packaging.  A small webOS JS service acts as a localhost relay (CORS, custom User-Agent) and hosts the LAN web editor.

## Layout

```
app/              The webOS web app (what runs on the TV)
  appinfo.json    App manifest (id, version, icons, splash)
  js/             App modules (see docs/ARCHITECTURE.md)
  css/  img/      Styles, icons, splash and logo
  vendor/         hls.js (light) and mpegts.js, unmodified
service/          webOS JS service: localhost relay + LAN web editor (service/editor/)
tests/            Unit tests (Node), Playwright suites, dev relay, mock provider
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
| `npm test` | Unit tests: name cleaner, relay, web editor (including encrypted backups), library |

## Trying it without a provider

`tests/mock/mock_provider.js` is a fictional Xtream provider: 63 channels in 14 groups, a full XMLTV guide with catch-up, 12 movies and 6 shows.  Any username and password work.

```bash
bash scripts/demo/make-media.sh          # once: synthetic demo streams (needs ffmpeg)
node tests/mock/mock_provider.js &       # http://127.0.0.1:8077, login demo / demo
npm run serve                            # then add the playlist in the app
```

## More

- [Architecture](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/ARCHITECTURE.md) and [decisions](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/DECISIONS.md)
- [Simulator guide](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/SIMULATOR.md)
- [Roadmap](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/ROADMAP.md)
- [Recording the demo media](Recording-the-demo-media) and [Releasing](Releasing)
