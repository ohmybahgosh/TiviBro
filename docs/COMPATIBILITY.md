# webOS compatibility

TiviBro is built and tested first on **webOS TV 25**, and runs the same code on older and newer TVs.  There is one IPK for every version.

| webOS TV | Years | Browser engine | Node (helper) | Status |
|---|---|---|---|---|
| 26 | 2026 | Chromium 132 | 20.12 | Supported.  Access Control Groups (`requiredACG`) are declared, so the stricter permission checks pass. |
| **25** | 2025 | Chromium 120 | 16.20 | **Main target.**  Developed and tested in the webOS 25 Simulator. |
| 24 | 2024 | Chromium 108 | 16.19 | Supported, same engine family as 25. |
| 22, 23 | 2022 to 2023 | Chromium 87, 94 | 12.x | Supported. |
| 6.x | 2021 | Chromium 79 | 8.12 | Supported.  Flex spacing comes from the fallback stylesheet.  `.gz` guides are unzipped by the helper. |
| 5.x | 2020 | Chromium 68 | 8.12 | Supported, same notes as 6.x. |
| 4.x | 2018 to 2019 | Chromium 53 | 0.12 | Best effort.  Code and helper are kept compatible, but nobody has tried it on a 4.x TV yet. |
| 3.x and older | 2016 and older | Chromium 38 or WebKit | 0.12 or older | Not supported. |

"Supported" for versions other than 25 means the code is checked against that engine (syntax and APIs, see below) and the fallbacks are in place.  Real-TV reports for those versions are very welcome.

## How the app stays compatible

- **One code base, no transpiling.**  App code is plain JavaScript that parses on Chromium 53: no `async`/`await`, object spread, optional chaining or `??`.  The helper service is plain ES5 for Node 0.12: `var` and `function` only.
- **`app/js/compat.js`** loads before everything else.  It adds `Promise.prototype.finally` (Chromium 63) and detects whether flexbox `gap` works (Chromium 84).  On TVs where it doesn't, `<html>` gets the class `nogap`.
- **`app/css/nogap.css`** spaces flex children with margins instead of `gap`, only under `.nogap`.  `scripts/gen-nogap.js` writes it from `app.css` (`npm run nogap`), and lint and tests fail if it is out of date.
- **Guarded newer APIs.**  `AbortController` (Chromium 66) and `DecompressionStream` (Chromium 80) are only used after a `typeof` check, with a fallback.
- **Zipped guides on every TV.**  Guide downloads go through the helper with the `/unz/<id>` prefix, and `service/unzip.js` unzips them with Node's zlib: `.gz` files, `Content-Encoding: gzip` or `deflate`, gzip sent without a label, and files zipped twice.  `/xfer/<id>` reports the zipped bytes so progress stays accurate.  With Network set to Direct, the app falls back to `DecompressionStream` (Chromium 80, webOS 22 and later).
- **`service/compat.js`** fills in `Object.assign`, `Buffer.from` and `crypto.timingSafeEqual` on Node versions that lack them.  `proxy.js` and `editor.js` load it first.
- **Codecs per TV.**  `app/js/caps.js` asks the TV what it decodes and applies known LG rules (for example no DTS on 2020 to 2022 models), then routes each stream to the player that can play it.
- **Access Control Groups.**  `appinfo.json` lists every Luna permission the app and its helper use: `systemconfig.query` (TV model and webOS version, `caps.js`) and `activity.operation` (keeps the helper running, `service.js`).  webOS 25 and older ignore the list; 26 checks it when present, and 27 requires it.

## Checked on every test run

`tests/unit/compat.test.js` (part of `npm test` and CI):

- Every app file parses as ES2015 (Chromium 53) and every helper file as ES5 (Node 0.12).
- No app file uses APIs that Chromium 53 lacks without a guard, and no helper file uses APIs Node 0.12 lacks.
- The shims work: `Object.assign`, `timingSafeEqual`, `Promise.prototype.finally`, and the `nogap` detection.
- `nogap.css` matches `app.css`, and `index.html` loads `compat.js` before the libraries.
- `requiredACG` covers every Luna call in the app and helper.

## Adding code

- Stick to ES5 plus the ES2015 parts Chromium 53 has (`let`/`const` and arrow functions are fine in the app, not in the helper).  Lint and `npm test` tell you when something slips in.
- New flex layouts can use `gap`; run `npm run nogap` afterwards.
- A new Luna call needs its ACG group in `appinfo.json` (see LG's [ACG guide](https://webostv.developer.lge.com/develop/guides/acg-guide)), and its service in the list at the end of `compat.test.js`.
