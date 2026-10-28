# webOS compatibility

TiviBro is built and tested first on **webOS TV 25**, and runs the same code on older and newer TVs.  There is one IPK for every version.

| webOS TV | Years | Browser engine | Node (helper) | Status |
|---|---|---|---|---|
| 26 | 2026 | Chromium 132 | 20.12 | Supported.  Access Control Groups (`requiredACG`) are declared, so the stricter permission checks pass. |
| **25** | 2025 | Chromium 120 | 16.20 | **Main target.**  Developed and tested in the webOS 25 Simulator. |
| 24 | 2024 | Chromium 108 | 16.19 | Supported, same engine family as 25. |
| 22, 23 | 2022 to 2023 | Chromium 87, 94 | 12.x | Supported.  Run in Chromium 87 and Node 12 (see below). |
| 6.x | 2021 | Chromium 79 | 8.12 | Supported.  Run in Chromium 78 and Node 8.12.  Flex spacing comes from the fallback stylesheet.  `.gz` guides are unzipped by the helper. |
| 5.x | 2020 | Chromium 68 | 8.12 | Supported, same notes as 6.x (run in Chromium 69). |
| 4.x | 2018 to 2019 | Chromium 53 | 0.12 | Supported.  Run in Chromium 53 and Node 0.12; not yet tried on a real 4.x TV. |
| 3.x and older | 2016 and older | Chromium 38 or WebKit | 0.12 or older | Not supported.  The app shows "This TV is too old for TiviBro" instead of a black screen. |

"Supported" for versions other than 25 means the code is checked against that engine (syntax and APIs, see below), the fallbacks are in place, and the app and helper have run on the matching Chromium and Node builds (see "Run on the real engines").  Real-TV reports for those versions are very welcome.

## How the app stays compatible

- **One code base, no transpiling.**  App code is plain JavaScript that parses on Chromium 53: no `async`/`await`, object spread, optional chaining or `??`.  The helper service is plain ES5 for Node 0.12: `var` and `function` only.
- **`app/js/compat.js`** loads before everything else (plain ES5).  It adds `Promise.prototype.finally` (Chromium 63), `Object.entries` and `Object.values` (Chromium 54) and `String.prototype.padStart`/`padEnd` (Chromium 57).  The last three are for the bundled players: hls.js uses `Object.entries`, and mpegts.js uses `padStart` when it reads an HEVC stream, which would otherwise stop HEVC channels on webOS 4.  It also detects whether flexbox `gap` works (Chromium 84); on TVs where it doesn't, `<html>` gets the class `nogap`.
- **Never a black screen.**  `compat.js` checks for modern JavaScript first: on webOS 3 and older it shows "This TV is too old for TiviBro".  After the page loads it checks that every part of the app arrived (a file that fails to load leaves its part missing) and shows "TiviBro could not start" with the error, the missing parts and the browser version, and OK to try again.  Errors during start-up show the same screen if the app still isn't up 8 seconds later; a slow first download never triggers it.
- **`app/css/nogap.css`** spaces flex children with margins instead of `gap`, only under `.nogap`.  `scripts/gen-nogap.js` writes it from `app.css` (`npm run nogap`), and lint and tests fail if it is out of date.
- **Bundled players.**  hls.js and mpegts.js are ES5 builds; their newer API use is either polyfilled by `compat.js` or behind their own feature checks (`AbortController`, `navigator.mediaCapabilities`, `Object.getOwnPropertyDescriptors`).
- **Symbols on every TV.**  The UI uses the TV's own fonts (`LG Smart UI`).  For symbols those fonts may lack (↺ ★ ▶ ✓ ⚠), `app/fonts/symbols.woff` (4 KB, a renamed subset of DejaVu Sans, licence in `app/fonts/LICENSE.txt`) is listed as a fallback with a `unicode-range`, so it is only ever used for those characters.  Emoji-only symbols such as ⏪ ⏩ are not used on screen.
- **Logos and posters over https.**  2018 to 2020 TVs without recent updates don't trust today's Let's Encrypt certificates, which many providers' image hosts use.  An https image that fails to load gets one more try through the helper (`Net.retryImage`), which doesn't depend on the TV's certificate list.
- **Memory.**  The guide keeps past programmes only for catch-up channels (up to their catch-up length and **Keep past days**); other channels keep the last three hours, which is all the guide can show for them.  On a 15,000-channel playlist with a 211 MB XMLTV file that is 0.85 instead of 1.1 million programmes, and 128 instead of 163 MB.  On webOS 4 and 5 (the TVs with the least memory) programme descriptions are kept to 250 characters instead of 400.
- **Full storage.**  Settings and edits that can't be saved (the TV's storage for the app is full) are logged and reported once on screen instead of failing silently, and a guide cache write that the TV aborts no longer leaves anything waiting.
- **Sloppy providers on every TV.**  Cheap panels send replies that Node's HTTP parser refuses: a stray control character in a header (Node 8 on webOS 5 and 6 refuses it and has no lenient mode; Node 12 and newer refuse it without one), bare LF line endings, and `Content-Length` sent twice (refused by Node 12 and newer even in lenient mode).  The helper asks for Node's lenient parser (`insecureHTTPParser`), and when Node still refuses a reply it asks again with its own forgiving reader, `service/rawhttp.js`, which accepts all three (and chunked replies).  Node 0.12 accepts them all by itself.
- **Guarded newer APIs.**  `AbortController` (Chromium 66) and `DecompressionStream` (Chromium 80) are only used after a `typeof` check, with a fallback.
- **Zipped guides on every TV.**  Guide downloads go through the helper with the `/unz/<id>` prefix, and `service/unzip.js` unzips them with Node's zlib: `.gz` files, `Content-Encoding: gzip` or `deflate`, gzip sent without a label, and files zipped twice.  `/xfer/<id>` reports the zipped bytes so progress stays accurate.  With Network set to Direct, the app falls back to `DecompressionStream` (Chromium 80, webOS 22 and later).
- **`service/compat.js`** fills in `Object.assign`, `Buffer.from` and `crypto.timingSafeEqual` on Node versions that lack them.  `proxy.js` and `editor.js` load it first.
- **Codecs per TV.**  `app/js/caps.js` asks the TV what it decodes and applies known LG rules (for example no DTS on 2020 to 2022 models), then routes each stream to the player that can play it.  The webOS version comes from the browser engine (Chromium 132 is webOS 26; anything newer counts as 26 until LG publishes the next mapping).
- **In-app updates** call `luna://org.webosbrew.hbchannel.service/install`, which exists only on rooted TVs with the Homebrew Channel and has no ACG group.  When the call is missing or refused, the app says it can't install by itself and points to the release page.
- **Access Control Groups.**  `appinfo.json` lists every Luna permission the app and its helper use: `systemconfig.query` (TV model and webOS version, `caps.js`) and `activity.operation` (keeps the helper running, `service.js`).  webOS 25 and older ignore the list; 26 checks it when present, and 27 requires it.

## Video decoding and hardware

Every stream is decoded by the TV's hardware decoder, whichever player TiviBro uses:

- **Built-in demuxer (MPEG-TS) and HLS:** mpegts.js and hls.js only unpack the stream (in a background worker, off the UI thread) and hand the compressed video to the browser's Media Source Extensions, which on webOS feed the TV's own decoder.
- **TV player:** the TV's media pipeline does everything, including unpacking.  It uses the least CPU but gives TiviBro no control over buffering, so Automatic uses it only where it is needed (Dolby Vision, codecs the browser refuses, servers that block the built-in path).

webOS doesn't let apps change decoder settings, switch the display's refresh rate or resolution, or pass audio through untouched, so there is nothing more to switch on.  The video sits on the TV's video plane behind the page; TiviBro keeps the page opaque around it and puts no transforms or filters on the video element, which keeps it there.

Start time: a lone CH+ or CH− starts the next channel at once (a quick run of presses waits until you stop, so it opens one stream rather than many), a channel number starts as soon as it can't get any longer, the helper reuses connections and DNS answers, and the player checks every 50 ms until the first frame.  How much buffer a stream needs before it starts is still set by the buffer profile, so start speed never comes out of stability.

Measured in a desktop browser with the CPU slowed to TV speed: steady fullscreen playback uses about 11 ms of main-thread time per second (around 1% of a core), and a channel change reaches a moving picture in about half a second (0.12 s at full speed) when the provider sends a few seconds up front.

## Checked on every test run

`tests/unit/compat.test.js` (part of `npm test` and CI):

- Every app file parses as ES2015 (Chromium 53), the bundled players as ES5, and every helper file as ES5 (Node 0.12).
- No app file uses APIs that Chromium 53 lacks without a guard, the bundled players use nothing Chromium 53 lacks that isn't polyfilled, and no helper file uses APIs Node 0.12 lacks.
- The stylesheets use no CSS that Chromium 53 ignores (8-digit hex colours, `inset`, `aspect-ratio`, `:is`/`:where`/`:has`, `clamp()`, `position: sticky`, grid and others; flex `gap` is covered by `nogap.css`).
- The shims work: `Object.assign`, `timingSafeEqual`, `Promise.prototype.finally`, `Object.entries`/`values`, `padStart`/`padEnd`, and the `nogap` detection.  A browser without modern JavaScript gets the "too old" screen.
- The webOS version detection maps every engine from Chromium 53 to 132.
- The symbol font and its licence are bundled, nothing on screen uses emoji-only symbols, and the helper relays sloppy replies (`tests/unit/proxy-lenient.test.js`).
- `appinfo.json` keeps a three-number version, the full HD layout and `disableBackHistoryAPI`.
- `nogap.css` matches `app.css`, and `index.html` loads `compat.js` before the libraries.
- `requiredACG` covers every Luna call in the app and helper.

Also, in a browser (`tests/soak/boot.js`, `npm run soak:boot`): a normal start shows no error screen, a file that fails to load shows "could not start" with the details, and a browser without modern JavaScript shows "too old".

## Run on the real engines

`npm run test:engines` (`tests/engines/run.sh`, Linux) downloads the official Node and Electron builds once into `.engines/` (git-ignored; Electron checked against its published SHA-256 sums) and runs:

- **The helper** (`tests/engines/helper.js`, plain ES5) on Node 0.12.2, 8.12.0, 12.22.12, 16.20.2 and 20.18.0: relaying with CORS, HEAD, Range, redirects, a custom User-Agent, unzipping `.gz` guides (also cut-off ones), MPEG-TS realignment, sloppy replies, the DNS cache, a provider that is down or never answers, a viewer zapping away (the provider stream closes), the log, the web editor (login, snapshot, save, encrypted backup and restore) and the webOS service wrapper.  40 checks, all passing on every version.  The same file runs with the unit tests on the current Node.
- **The app** (`tests/engines/browser/`) at 1920x1080 in Electron 1.4.16 (Chromium 53, webOS 4), 4.2.12 (Chromium 69, webOS 5), 7.3.3 (Chromium 78, webOS 6) and 11.5.0 (Chromium 87, webOS 22), against the mock provider: start-up without the error screen, channels, the guide, remote-key navigation, a channel preview that plays, Settings, and no page errors.  All passing on every engine, with screenshots in `tests/.shots/engines-*/`.  A zipped XMLTV guide (`.xml.gz` without a Content-Encoding label) is also unzipped by the helper and read on Chromium 53 and 87.

What this found and fixed: Node 8.12 (webOS 5 and 6) refused provider replies with a stray control character in a header, and Node 12 and newer refused `Content-Length` sent twice; both now go through `rawhttp.js`.

Still not covered: a real TV's hardware decoder (Electron decodes in software), its memory limits, and the webOS media pipeline used by the TV player.  Electron 1.4 needs GConf and the Pango 1.40 libraries of Ubuntu 18.04 (current Pango crashes it); `run.sh` fetches those from archive.ubuntu.com and uses them for Electron 1.4 only.

## Adding code

- Stick to ES5 plus the ES2015 parts Chromium 53 has (`let`/`const` and arrow functions are fine in the app, not in the helper).  Lint and `npm test` tell you when something slips in.
- New flex layouts can use `gap`; run `npm run nogap` afterwards.
- A new Luna call needs its ACG group in `appinfo.json` (see LG's [ACG guide](https://webostv.developer.lge.com/develop/guides/acg-guide)), and its service in the list at the end of `compat.test.js`.
