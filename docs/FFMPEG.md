# ffmpeg for audio conversion and seek previews

TiviBro carries a tiny, fully static ffmpeg in its package (or, in a build without it, downloads it to the TV) and use it to convert audio the TV can't decode.  Video is always stream-copied, never decoded or re-encoded, so the TV's hardware video decoder still does the heavy lifting and the CPU cost stays low.

The binary is not part of the `.ipk`.  It lives in its own GitHub pre-release, built by `.github/workflows/ffmpeg.yml` from `scripts/ffmpeg/build.sh`, and the helper fetches it only when a stream needs it.

## Why

- **DTS on 2020 to 2022 LG TVs.**  LG removed DTS decoding from the 2020 to 2022 models.  Many movie files from providers carry DTS or DTS-HD MA as the only audio track, so they play silent.  ffmpeg decodes the DTS core and re-encodes it to AC-3 or E-AC-3, which every webOS TV plays and passes through to a soundbar.
- **TrueHD (and MLP).**  webOS TVs don't decode Dolby TrueHD themselves; at best some models pass it through over eARC.  Without an eARC receiver the track is silent, so it converts to AC-3.
- **Multichannel FLAC, Opus, Vorbis and PCM.**  Support for these in MKV varies by model and webOS version, and multichannel tracks often fail where stereo works.  The binary can convert them to AC-3 or E-AC-3, or downmix to stereo AAC with the `pan` filter.  The helper converts multichannel FLAC today (`Caps.unplayable()` in `app/js/caps.js` decides what counts).

## What it can do

It is cut down to what the helper needs, to stay small:

| Area | Enabled |
| --- | --- |
| Input protocols | `http`, `https` (mbedTLS), `tcp`, `file`, `pipe` (so `-i pipe:0` works) |
| Demuxers | Matroska/WebM, MP4/MOV, MPEG-TS, AVI, FLV |
| Audio decoders | `dca` (DTS, including the core of DTS-HD), `truehd`, `mlp`, `flac`, `ac3`, `eac3`, `aac`, `mp3`, `mp2`, `opus`, `vorbis`, all `pcm_*` |
| Audio encoders | `ac3`, `eac3`, `aac` (native) |
| Video decoders | `h264`, `hevc`, `mpeg2video`, `mpeg4`: only for seek previews, one keyframe at a time (`service/seekprev.js`).  Playing video is never decoded here. |
| Video encoders | `mjpeg` (the seek preview pictures) |
| Parsers | `h264`, `hevc`, `av1`, `mpeg4video`, `mpegvideo`, `vp9`, plus the audio parsers MPEG-TS and Matroska need |
| Bitstream filters | `h264_mp4toannexb`, `hevc_mp4toannexb`, `aac_adtstoasc`, `extract_extradata`, `vp9_superframe`, `av1_frame_split` |
| Muxers | Matroska, MPEG-TS, MP4 (fragmented), ADTS, `null` |
| Filters | `aresample`, `aformat`, `anull`, `pan`, `atrim`, `asetpts`, `scale`, `format`, `null` and the internal ones the ffmpeg CLI needs |

There is no video encoder besides `mjpeg`, no `ffprobe` or `ffplay`, no devices, no network servers, no zlib (so `Content-Encoding: gzip` responses and zlib-compressed Matroska tracks are not supported).  For stream information, run `ffmpeg -hide_banner -i <url>` and parse stderr.

`mp2` decoding and the `null` muxer are small additions beyond the original list: MP2 is common in MPEG-TS channel streams, and `-f null -` is handy for timing tests on the TV.

### Typical commands

```sh
# DTS or TrueHD in MKV -> AC-3 5.1, video copied, MKV to stdout
ffmpeg -hide_banner -nostdin -i "$URL" -map 0:v:0 -map 0:a:0 -c:v copy -c:a ac3 -b:a 640k -f matroska pipe:1

# Same, as MPEG-TS (h264/hevc_mp4toannexb is inserted automatically)
ffmpeg -hide_banner -nostdin -i "$URL" -map 0:v:0 -map 0:a:0 -c:v copy -c:a eac3 -b:a 768k -f mpegts pipe:1

# Fragmented MP4 to stdout: AC-3/E-AC-3 needs delay_moov, or the header can't be written
ffmpeg -hide_banner -nostdin -i "$URL" -map 0:v:0 -map 0:a:0 -c:v copy -c:a ac3 \
  -f mp4 -movflags frag_keyframe+empty_moov+delay_moov pipe:1

# https fetched by the helper itself and piped in
ffmpeg -hide_banner -f matroska -i pipe:0 -map 0 -c:v copy -c:a ac3 -f matroska pipe:1

# Stereo downmix to AAC
ffmpeg -hide_banner -nostdin -i "$URL" -vn -af "pan=stereo|FL<FL+0.7*FC+0.7*SL|FR<FR+0.7*FC+0.7*SR" -c:a aac -b:a 192k -f adts pipe:1
```

ffmpeg does not verify TLS certificates by default (`-tls_verify 0`), and there is no CA bundle in the binary.  That matches how the TV's own player treats provider links.  If verification is ever wanted, pass `-tls_verify 1 -ca_file <bundle>` with a CA file shipped alongside.

DNS comes from musl's resolver, which reads `/etc/resolv.conf` directly.  If a TV turns out to have no usable `/etc/resolv.conf`, the helper can resolve the host itself and pass an IP address with a `Host` header (`-headers "Host: example.com"`), or fetch the stream and pipe it in.

## How the helper uses it

`service/ffmpeg.js` finds or fetches the binary; `service/convert.js` probes and converts; `app/js/convert.js` decides when (see the user guide's "Sound the TV can't play").

**Finding it.**  `TIVIBRO_FFMPEG=<path>` uses that program (tests, the dev helper on a computer).  Otherwise it is `Storage.sub('bin')/ffmpeg-7.1-tb2-<arch>`: the helper's private folder on the TV's big app storage (exec allowed, `nosuid`), never memory (`/tmp`).  The arch is `armv7` unless the helper's own Node is a 64-bit ARM program (`process.arch === 'arm64'`); `uname -m` only confirms the TV is ARM, since a C2 reports `aarch64` with a 32-bit userland.

**Getting it.**  Release packages carry both `.gz` builds in `service/ffmpeg-bundle/` (`scripts/ffmpeg/bundle.sh`, run by `scripts/build.sh`, downloads them from the release in `TAG`, checks them against `SHA256` and adds the licences and `SOURCE.txt`; `TIVIBRO_NO_FFMPEG_BUNDLE=1` leaves them out).  Five seconds after the helper starts it unpacks the one for this TV the same way a download is handled below, with no question asked.  Without a bundle, on first need (the app asks) or from **Settings > Playback > Get the converter now**, the helper downloads `tivibro-ffmpeg-<arch>.gz` (following GitHub's redirect, retrying once with the bundled root certificates on old TVs), checks its SHA-256 against the constant in `service/ffmpeg.js`, unpacks it with Node's zlib, `chmod 700`s it, runs `-version`, and only then renames it into place and deletes older `ffmpeg-*` files.  A hash that doesn't match, or a placeholder hash, means nothing is unpacked or run.

**The release constants** live in one place, at the top of `service/ffmpeg.js`: `TAG` (`ffmpeg-7.1-tb2`) and `SHA256.armv7` / `SHA256.aarch64` (the SHA-256 of the `.gz` files, as in `SHA256SUMS`).  Until they are filled in they read `TODO-SHA256-ARMV7` and `TODO-SHA256-AARCH64`, and the helper refuses to download.  A new `tbN` tag means updating `TAG` and both hashes together.

**Routes** (on the helper, behind TiviBro's secret like the other control routes): `GET /ffmpeg/status` (`none`, `downloading` with `percent`, `ready` with `version`, `size`, `where`, or `failed` with `error`), `POST /ffmpeg/get`, `POST /ffmpeg/remove`, `GET /convert/key`, and `GET /convert/probe?u=<url>`, which runs `ffmpeg -hide_banner -i <url>` and parses stderr into audio tracks (codec, channels, language, default, title), video codec and duration, kept per link while the helper runs.

**Converting.**  `GET /convert/<key>/movie.mkv?u=<url>&t=<seconds>&a=<audio track>` (or `movie.ts` for live channels).  The key is random per helper start and only handed to TiviBro, since the TV's player can't send the secret.  ffmpeg reads the movie through the helper's own relay (`http://127.0.0.1:<port>/ua/.../x/...`), so the playlist's User-Agent, redirects, odd provider replies and certificates are handled as for every other stream, Range requests make `-ss` cheap, and ffmpeg's own TLS is never used.  `&in=pipe` has the helper fetch the movie and feed `pipe:0` instead.  The command:

```sh
nice -n 10 ffmpeg -hide_banner -nostdin -loglevel error -stats -stats_period 5 -protocol_whitelist http,tcp \
  -ss $T -i "$RELAYED_URL" -copyts -start_at_zero -map 0:v:0? -map 0:a:$A -c:v copy \
  -c:a ac3 -b:a 640k -sn -dn -max_muxing_queue_size 1024 -f matroska pipe:1
```

- AC-3 640k for 3 to 6 channels, 224k for mono or stereo, and `-ac 6` for 7.1: ffmpeg's E-AC-3 encoder can't make 7.1 (it quietly drops to 5.0), so 7.1 is mixed down to 5.1 AC-3.  A track the TV already plays (AC-3, E-AC-3, AAC, MP3, MP2) is copied, not re-encoded.
- `-copyts -start_at_zero` keeps the movie's own times, so a seek to 1:00:00 makes a stream that starts at 1:00:00 (video from the keyframe before it).  The app works out whether the TV's player shows those times or counts from zero (`app/js/player.js`).  Live channels (`movie.ts`, `-f mpegts`) start at zero.
- The output is piped to the player with backpressure and no `Content-Length`; a request for a later byte gets 416.  One conversion at a time: a new one, or the player hanging up, stops ffmpeg (TERM, then KILL after 2 s).  The helper log has `convert start` (source and target codecs), `convert speed` every 30 s and `convert done` / `stopped` / `failed` with ffmpeg's last error lines.

## Binaries and downloads

Release tag `ffmpeg-7.1-tb2` (a pre-release, never marked latest), titled "ffmpeg for TiviBro (audio conversion)":

| Asset | Contents |
| --- | --- |
| `tivibro-ffmpeg-armv7.gz` | ARMv7-A, VFPv3 + NEON, EABI5 hard float, static musl.  For every webOS TV with a 32-bit userland, which is all of them so far, including 64-bit kernels like the C2. |
| `tivibro-ffmpeg-aarch64.gz` | ARMv8-A (Cortex-A53 baseline), static musl, for TVs with a 64-bit userland. |
| `SHA256SUMS` | SHA-256 of every asset above (the `.gz` files, not their contents) |
| `SOURCE.txt` | ffmpeg version, source tarball URL and SHA-256, the exact configure line, toolchain, and SHA-256 of the unpacked binaries |
| `LICENSE.md`, `COPYING.LGPLv3`, `COPYING.LGPLv2.1`, `LICENSE.mbedtls.txt` | Licenses |

Download URLs follow the usual GitHub pattern:

```
https://github.com/ohmybahgosh/TiviBro/releases/download/ffmpeg-7.1-tb2/tivibro-ffmpeg-armv7.gz
https://github.com/ohmybahgosh/TiviBro/releases/download/ffmpeg-7.1-tb2/tivibro-ffmpeg-aarch64.gz
https://github.com/ohmybahgosh/TiviBro/releases/download/ffmpeg-7.1-tb2/SHA256SUMS
```

Pick the binary by the userland, not the kernel: `uname -m` says `aarch64` on a C2, but its userland is 32-bit.  The helper checks its own process (`process.arch` in Node: `arm` means armv7, `arm64` means aarch64), checks the `.gz` against the SHA-256 in `service/ffmpeg.js`, unpacks it into app storage, `chmod 700`s it and runs it from there (app storage is mounted `nosuid` but allows exec).  See "How the helper uses it" above.

### Sizes

Built with ffmpeg 7.1.1 and mbedTLS 3.6.5, stripped:

| Binary | Unpacked | Gzipped |
| --- | --- | --- |
| `tivibro-ffmpeg-armv7` | about 4.8 MB | about 2.4 MB |
| `tivibro-ffmpeg-aarch64` | about 4.8 MB | about 2.4 MB |

(tb1, audio only, was about 3.0 MB, 1.6 MB gzipped.)

Building with `ENABLE_TLS=0` drops https and saves roughly 0.3 MB; the helper would then fetch https itself and pipe it to `-i pipe:0`.

## License

This is an LGPL build: configure runs without `--enable-gpl` and without `--enable-nonfree`, so no GPL or nonfree code is included.  mbedTLS (Apache-2.0) is only allowed by ffmpeg under the LGPL **version 3**, so the build uses `--enable-version3` and the binary as a whole is LGPL v3 or later.  The workflow checks the built binary's `-buildconf` for `--enable-gpl` and `--enable-nonfree` and fails if either appears.

It is published as its own release, with its licenses and `SOURCE.txt`, and TiviBro's package carries the same files in `service/ffmpeg-bundle/` (on the TV: the helper's folder).  ffmpeg stays a separate program that TiviBro runs, not linked into it.  To get the exact source:

1. Read the ffmpeg version, tarball URL and SHA-256 from `SOURCE.txt` (for 7.1.1: `https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz`).  The mbedTLS tarball URL and SHA-256 are listed there too.
2. The build script and workflow are in this repository at `scripts/ffmpeg/build.sh` and `.github/workflows/ffmpeg.yml`, at the commit named in `SOURCE.txt`.  ffmpeg is built unmodified.

## Rebuilding

### On GitHub

Actions > **ffmpeg** > Run workflow, and enter a tag (default `ffmpeg-7.1-tb2`).  The workflow builds both architectures, strips them, runs the smoke test under qemu-user, then creates the release or updates its assets in place.  Bump the `tbN` suffix when the binary changes in a way the helper should notice, and update `TAG` and both `SHA256` values in `service/ffmpeg.js` to match (copy them from the release's `SHA256SUMS`).

### Locally (x86_64 Linux)

```sh
sudo apt-get install binutils-arm-linux-gnueabihf binutils-aarch64-linux-gnu qemu-user ffmpeg
bash scripts/ffmpeg/build.sh all             # builds both, about 3 to 5 minutes each
bash scripts/ffmpeg/build.sh test all        # qemu smoke test
```

Output goes to `$TMPDIR/tivibro-ffmpeg/out` (or `/tmp/...`) unless you pass an output directory.  Nothing is written into the repository.  See `scripts/ffmpeg/README.md` for options.

### Toolchain

[Zig](https://ziglang.org) as a cross C compiler (`zig cc`, which is clang with musl bundled), installed from the pinned `ziglang` wheel on PyPI and checked by SHA-256.  That avoids musl.cc downloads, which are often blocked or rate-limited on CI runners, and needs no Docker.  Targets are `arm-linux-musleabihf` with `-mcpu=cortex_a9+neon` and `aarch64-linux-musl` with `-mcpu=cortex_a53`.  The result has no program interpreter and no shared library dependencies, so the TV's glibc version and float ABI don't matter.

### Updating ffmpeg

Set `FFMPEG_VERSION` and `FFMPEG_SHA256` at the top of `scripts/ffmpeg/build.sh` (or pass them as environment variables) and run the workflow with a new tag.  The script refuses a tarball whose checksum doesn't match.  The same applies to `MBEDTLS_VERSION`/`MBEDTLS_SHA256` and `ZIG_VERSION`/`ZIG_WHEEL_SHA256`.

### Smoke test

`build.sh test` runs each binary under `qemu-arm-static` or `qemu-aarch64-static` and:

- checks `-version`, the required decoders, encoders and protocols, and that the build is LGPL;
- makes a 10 second DTS 5.1 + H.264 MKV with the host ffmpeg (`-c:a dca -strict -2`), plus a TrueHD 5.1 one;
- converts DTS to AC-3 in MKV from a file, DTS from stdin to E-AC-3 in MPEG-TS, DTS over HTTP to AC-3 in fragmented MP4 on stdout, TrueHD to E-AC-3, and a stereo `pan` downmix to AAC;
- checks every output with the host `ffprobe`: audio codec, 6 channels, copied video codec, 10 second duration.

## Seek previews

`service/seekprev.js` (`GET /preview/<key>/frame.jpg?u=<movie>&t=<seconds>&w=<width>`, the converter's key) makes one small picture of the movie playing:

```sh
nice -n 15 ffmpeg -hide_banner -nostdin -loglevel error -threads 1 -protocol_whitelist http,tcp,file \
  -probesize 2000000 -analyzeduration 0 -reconnect 1 -reconnect_at_eof 1 -reconnect_delay_max 0 \
  -noaccurate_seek -ss $T -i "http://127.0.0.1:$PORT/preview/$KEY/src?u=$MOVIE" \
  -map 0:v:0 -an -sn -dn -frames:v 1 -fps_mode passthrough -vf scale=320:-2:flags=fast_bilinear,format=yuvj420p \
  -q:v 5 -f mjpeg pipe:1
```

- `-ss` before `-i` uses the file's own index (Matroska Cues, the MP4 sample table): ffmpeg reads the header, the index and the keyframe at or before `$T`, not the movie.  The first frame decoded from there is that keyframe, so nothing past it is needed (`-skip_frame nokey` was dropped: with it, the decoder waited for the next keyframes and read megabytes more).
- `-fps_mode passthrough` keeps that keyframe even when it lies well before `$T`; `format=yuvj420p`: the JPEG encoder wants full-range YUV.
- **The piece cache** (`service/blockcache.js`, `/preview/<key>/src`): ffmpeg reads the movie through the helper, which keeps what was read in 128 KB pieces (16 MB at most, 4 MB on a TV short of memory) and answers at most 256 KB at a time; `-reconnect_at_eof` makes ffmpeg ask again from where it got to.  Every run reads the file's start and index again, and those now come from memory: from the second picture on, only the pieces around the keyframe are asked from the source (one or two requests instead of five to seven).  Without the 256 KB answers, the network buffers let one connection swallow many MB ffmpeg never used.
- On a 2022 C2 (65", 2 GB), from Google Drive through the helper, before the piece cache: a 1080p H.264 MP4 picture in 2.2 to 3.1 s at about 30 MB of memory, a 4K HEVC MKV one in 4.6 to 4.8 s at about 68 MB.  A 4K frame takes over twice the memory, so with Memory-safe playback on the app asks only for movies up to 1080p (Settings > Playback > Seek previews, Automatic).
- One ffmpeg at a time, the newest "now" request first, pictures kept in memory for the movie playing (up to 200, about 3 MB).
