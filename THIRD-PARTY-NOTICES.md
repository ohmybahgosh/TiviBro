# Third-party notices

TiviBro itself is under the [MIT License](LICENSE), copyright (c) 2026 OhMyBahGosh.  It is built with the
work of others, listed here with their licenses.  This file ships inside the TV app (`THIRD-PARTY-NOTICES.md`
next to `index.html`), and the TV shows the same list under **Settings > Updates, about and diagnostics >
Open-source licenses and credits**.  The phone app shows its own list under **About** (the ⓘ at the top).

## In the TV app

| Component | Version | License | Where |
|---|---|---|---|
| [hls.js](https://github.com/video-dev/hls.js) | 1.5.20 | Apache-2.0 | `app/vendor/hls.min.js`, license in `app/vendor/hls-1.5.20.LICENSE.txt` |
| [mpegts.js](https://github.com/xqq/mpegts.js) | 1.8.0, with TiviBro's changes | Apache-2.0 | `app/vendor/mpegts.js`, license in `app/vendor/mpegts-1.8.0.LICENSE.txt`, changes in `app/vendor/PATCHES.md` |
| [dash.js](https://github.com/Dash-Industry-Forum/dash.js) | 4.7.4 | BSD-3-Clause | `app/vendor/dash-4.7.4.min.js`, license in `app/vendor/dash-4.7.4.LICENSE.txt` |
| QR Code Generator for JavaScript, Kazuhiko Arase | | MIT | `app/vendor/qrcode.js`, license in its header |
| Roboto and Roboto Mono (subsets: digits and the colon) | | Apache-2.0 | `app/fonts/digits*.woff`, license in `app/fonts/LICENSE-roboto.txt` |
| DejaVu Sans (a subset, renamed TiviBro Symbols) | | Bitstream Vera license, DejaVu changes public domain | `app/fonts/symbols.woff`, license in `app/fonts/LICENSE.txt` |

## In the network helper (part of the TV app)

| Component | Version | License | Where |
|---|---|---|---|
| [FFmpeg](https://ffmpeg.org) (the audio converter) | 7.1.1 | LGPL v3 or later (built with `--enable-version3`) | `service/ffmpeg-bundle/`, licenses in `COPYING.LGPLv3`, `COPYING.LGPLv2.1` and `LICENSE.md` there |
| [Mbed TLS](https://github.com/Mbed-TLS/mbedtls), inside the converter | 3.6.5 | Apache-2.0 | `service/ffmpeg-bundle/LICENSE.mbedtls.txt` |

**FFmpeg source.**  The converter is an unmodified FFmpeg 7.1.1, built from
<https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz> (and Mbed TLS 3.6.5 from its GitHub release) by
`scripts/ffmpeg/build.sh` and `.github/workflows/ffmpeg.yml` in this repository; `service/ffmpeg-bundle/SOURCE.txt`
records the exact sources, checksums and build.  Rebuild it with that script, or replace
`service/ffmpeg-bundle/tivibro-ffmpeg-*.gz` with your own build of the same command-line tool: TiviBro only runs it
as a separate program.

## In the phone app (Android)

| Component | License |
|---|---|
| AndroidX: Jetpack Compose (UI, Material 3, material icons), Activity, Core, Lifecycle, Navigation, WorkManager, Browser | Apache-2.0 |
| Kotlin standard library and kotlinx.coroutines | Apache-2.0 |
| [Coil](https://github.com/coil-kt/coil) | Apache-2.0 |
| Google code scanner (Google Play services) | [Google APIs Terms of Service](https://developers.google.com/terms) |

## Data and services TiviBro uses (with credit)

TiviBro talks to these services from your TV, with your own keys where one is needed.  Their own terms apply.

- **TMDB**, movie and show details and posters.  This product uses the TMDB API but is not endorsed or certified by TMDB.
- **OpenSubtitles.com**, subtitles for Find subtitles.
- **Channel logos**: [tv-logo/tv-logos](https://github.com/tv-logo/tv-logos) (Creative Commons BY-SA and BY-NC-SA,
  per logo) and [iptv-org/database](https://github.com/iptv-org/database) (Unlicense).  The logos themselves are
  trademarks of their owners.
- **Public guides**: epg.pw, iptv-epg.org, epgshare01, Pluto TV's guide through i.mjh.nz, and EPGTalk for the
  sports guides.
- **YouTube**, for trailers, opened in the TV's own YouTube app.

The full license texts are in the files named above, in the TV app's package and in this repository.
