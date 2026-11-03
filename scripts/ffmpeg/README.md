# scripts/ffmpeg

Builds the tiny static LGPL ffmpeg that TiviBro's network helper uses on the TV to convert audio (DTS, TrueHD, multichannel FLAC and friends) to AC-3, E-AC-3 or AAC while copying the video.  Background, licensing and download URLs are in [docs/FFMPEG.md](../../docs/FFMPEG.md).

## Usage

```sh
bash scripts/ffmpeg/build.sh armv7|aarch64|all [out-dir]
bash scripts/ffmpeg/build.sh test armv7|aarch64|all [out-dir]
```

The first form downloads the pinned toolchain and sources (checked by SHA-256), builds and strips `tivibro-ffmpeg-<arch>`, and writes `SOURCE-<arch>.txt` plus the license files to the output directory.  The second runs the binaries under qemu-user and does real conversions, checked with the host `ffprobe`.

Host requirements (x86_64 Linux): bash, curl, python3 with pip, make, tar, xz, bzip2, and `binutils-arm-linux-gnueabihf` / `binutils-aarch64-linux-gnu` (or `llvm-strip`/`llvm-nm`).  The test also needs `qemu-user-static` and a host `ffmpeg`/`ffprobe` with the experimental `dca` encoder (Ubuntu's `ffmpeg` package has it).

## Options (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `FFMPEG_VERSION`, `FFMPEG_SHA256` | 7.1.1 | ffmpeg release tarball |
| `MBEDTLS_VERSION`, `MBEDTLS_SHA256` | 3.6.5 | mbedTLS release tarball (for https) |
| `ZIG_VERSION`, `ZIG_WHEEL_SHA256` | 0.14.1 | `ziglang` wheel from PyPI (the cross compiler) |
| `ENABLE_TLS` | 1 | `0` builds without https and mbedTLS (LGPL v2.1+ instead of v3+) |
| `CACHE_DIR` | `<tmp>/tivibro-ffmpeg/cache` | downloads and the unpacked toolchain |
| `WORK_DIR` | `<tmp>/tivibro-ffmpeg/work` | build trees and test fixtures |
| `JOBS` | `nproc` | parallel make jobs |

`<tmp>` is `$RUNNER_TEMP`, else `$TMPDIR`, else `/tmp`.  Nothing is written into the repository.

Each tarball is tried from upstream first (ffmpeg.org, GitHub) and then from the Ubuntu archive, which carries the same upstream-signed files.  Both must match the pinned SHA-256.

## What's enabled

The component lists are the `FF_COMPONENTS` and `FF_BASE` arrays near the middle of `build.sh`.  Keep additions small: the target is under 4 MB per stripped binary, and the workflow warns above that.  Don't add `--enable-gpl` or `--enable-nonfree`; the smoke test fails the build if either shows up.

## Publishing

Run the **ffmpeg** workflow (`.github/workflows/ffmpeg.yml`) from the Actions tab with a tag such as `ffmpeg-7.1-tb1`.  It builds both architectures, runs the smoke test, and creates or updates a pre-release with `tivibro-ffmpeg-armv7.gz`, `tivibro-ffmpeg-aarch64.gz`, `SHA256SUMS`, `SOURCE.txt` and the license files.
