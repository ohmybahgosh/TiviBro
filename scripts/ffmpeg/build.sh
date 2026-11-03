#!/usr/bin/env bash
# Build a tiny, fully static, LGPL-only ffmpeg for TiviBro's network helper on
# LG webOS TVs.  Audio conversion only: video is stream-copied, never decoded.
#
# Usage:
#   scripts/ffmpeg/build.sh <armv7|aarch64|all> [out-dir]
#   scripts/ffmpeg/build.sh test <armv7|aarch64|all> [out-dir]
#
# "test" runs the built binaries under qemu-user (qemu-user-static) and does a
# real DTS 5.1 -> AC-3 conversion, checked with the host ffmpeg/ffprobe.
#
# Output (default out-dir: $RUNNER_TEMP or $TMPDIR or /tmp, + /tivibro-ffmpeg/out):
#   <out-dir>/tivibro-ffmpeg-<arch>      stripped static binary
#   <out-dir>/SOURCE-<arch>.txt          ffmpeg version, configure line, source URLs
#
# Toolchain: Zig (clang + bundled musl libc), installed from the pinned PyPI
# "ziglang" wheel and verified by SHA-256.  Zig cross-compiles to musl for
# ARM out of the box, so no musl.cc download (which is often blocked or
# rate-limited on CI runners) and no Docker are needed.  Host requirements:
# bash, curl, python3 (+ pip), make, tar, xz, bzip2, unzip or python zipfile,
# and a strip/nm that understands the target ELF (binutils-arm-linux-gnueabihf
# and binutils-aarch64-linux-gnu, or llvm-strip/llvm-nm).
#
# Environment overrides (all optional):
#   FFMPEG_VERSION / FFMPEG_SHA256     ffmpeg release tarball (.tar.xz)
#   MBEDTLS_VERSION / MBEDTLS_SHA256   mbedTLS release tarball (.tar.bz2)
#   ZIG_VERSION / ZIG_WHEEL_SHA256     ziglang wheel for x86_64 Linux hosts
#   ENABLE_TLS=0                       build without https (helper pipes https to stdin)
#   CACHE_DIR                          downloads + toolchain (default <tmp>/tivibro-ffmpeg/cache)
#   WORK_DIR                           build tree (default <tmp>/tivibro-ffmpeg/work)
#   JOBS                               parallel make jobs (default: nproc)
set -euo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-7.1.1}"
FFMPEG_SHA256="${FFMPEG_SHA256:-733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1}"
MBEDTLS_VERSION="${MBEDTLS_VERSION:-3.6.5}"
MBEDTLS_SHA256="${MBEDTLS_SHA256:-4a11f1777bb95bf4ad96721cac945a26e04bf19f57d905f241fe77ebeddf46d8}"
ZIG_VERSION="${ZIG_VERSION:-0.14.1}"
ZIG_WHEEL_SHA256="${ZIG_WHEEL_SHA256:-6eb9d4d759b292c83810dbee2e9e8e3fbfbf01d864e6e9811bae711fd74e1c2f}"
ENABLE_TLS="${ENABLE_TLS:-1}"

# Upstream URL first, byte-identical mirror second (Ubuntu ships the
# upstream-signed tarballs as *.orig.tar.*).  Both are checked against the
# same SHA-256, so a mirror can never change what gets built.
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_MIRROR="http://archive.ubuntu.com/ubuntu/pool/universe/f/ffmpeg/ffmpeg_${FFMPEG_VERSION}.orig.tar.xz"
MBEDTLS_URL="https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-${MBEDTLS_VERSION}/mbedtls-${MBEDTLS_VERSION}.tar.bz2"
MBEDTLS_MIRROR="http://archive.ubuntu.com/ubuntu/pool/universe/m/mbedtls/mbedtls_${MBEDTLS_VERSION}.orig.tar.bz2"

# Kept outside the repo by default so nothing shows up in git status.
BASE_TMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tivibro-ffmpeg"
CACHE_DIR="${CACHE_DIR:-$BASE_TMP/cache}"
WORK_DIR="${WORK_DIR:-$BASE_TMP/work}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"

log() { printf '\n==> %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

MODE=build
if [ "${1:-}" = test ]; then MODE=test; shift; fi
ARCH_ARG="${1:-}"
OUT_DIR="${2:-$BASE_TMP/out}"
case "$ARCH_ARG" in
  armv7|aarch64) ARCHES=("$ARCH_ARG") ;;
  all) ARCHES=(armv7 aarch64) ;;
  *) usage ;;
esac

mkdir -p "$CACHE_DIR" "$WORK_DIR" "$OUT_DIR"
CACHE_DIR="$(cd "$CACHE_DIR" && pwd)"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

sha_ok() { echo "$2  $1" | sha256sum -c --status - 2>/dev/null; }

# fetch <dest> <sha256> <url> [mirror...]
fetch() {
  local dest="$1" sum="$2"; shift 2
  if [ -f "$dest" ] && sha_ok "$dest" "$sum"; then return 0; fi
  rm -f "$dest"
  local url
  for url in "$@"; do
    log "Downloading $url"
    if curl -fL --retry 4 --retry-delay 3 --connect-timeout 20 -o "$dest.part" "$url"; then
      if sha_ok "$dest.part" "$sum"; then mv "$dest.part" "$dest"; return 0; fi
      echo "checksum mismatch for $url (got $(sha256sum "$dest.part" | cut -d' ' -f1))" >&2
    fi
    rm -f "$dest.part"
  done
  die "could not download a verified copy of $(basename "$dest")"
}

# ---------------------------------------------------------------- toolchain
install_zig() {
  ZIG_HOME="$CACHE_DIR/zig-$ZIG_VERSION"
  ZIG="$ZIG_HOME/ziglang/zig"
  [ -x "$ZIG" ] && return 0
  [ "$(uname -m)" = x86_64 ] || die "the pinned zig wheel is for x86_64 hosts; set ZIG_VERSION/ZIG_WHEEL_SHA256 for $(uname -m)"
  log "Installing zig $ZIG_VERSION (PyPI wheel)"
  local whl_dir="$CACHE_DIR/zig-wheel"
  rm -rf "$whl_dir" && mkdir -p "$whl_dir"
  printf 'ziglang==%s --hash=sha256:%s\n' "$ZIG_VERSION" "$ZIG_WHEEL_SHA256" > "$whl_dir/req.txt"
  python3 -m pip download --quiet --no-deps --only-binary=:all: \
    --require-hashes -r "$whl_dir/req.txt" -d "$whl_dir"
  rm -rf "$ZIG_HOME" && mkdir -p "$ZIG_HOME"
  python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' \
    "$(ls "$whl_dir"/ziglang-*.whl)" "$ZIG_HOME"
  chmod +x "$ZIG"
  "$ZIG" version
}

# Per-arch settings: zig target, zig -mcpu, ffmpeg --arch, binutils prefix.
arch_vars() {
  ARCH_NAME="$1"
  case "$1" in
    armv7)
      # 32-bit userland on every webOS TV seen so far (EABI5, hard float).
      # Cortex-A9 baseline: ARMv7-A + VFPv3 + NEON, runs on A7/A9/A15/A53/A76.
      ZTARGET=arm-linux-musleabihf; ZCPU=cortex_a9+neon
      FF_ARCH=arm; BU_PREFIX=arm-linux-gnueabihf- ;;
    aarch64)
      ZTARGET=aarch64-linux-musl; ZCPU=cortex_a53
      FF_ARCH=aarch64; BU_PREFIX=aarch64-linux-gnu- ;;
  esac
}

make_wrappers() {
  local d="$1"
  mkdir -p "$d"
  # Isolated zig caches so parallel/CI builds don't collide.
  cat > "$d/tivibro-$ARCH_NAME-cc" <<EOF
#!/bin/sh
export ZIG_GLOBAL_CACHE_DIR="$CACHE_DIR/zig-global-cache" ZIG_LOCAL_CACHE_DIR="$d/zig-cache"
exec "$ZIG" cc -target $ZTARGET -mcpu=$ZCPU "\$@"
EOF
  cat > "$d/tivibro-$ARCH_NAME-ar" <<EOF
#!/bin/sh
exec "$ZIG" ar "\$@"
EOF
  cat > "$d/tivibro-$ARCH_NAME-ranlib" <<EOF
#!/bin/sh
exec "$ZIG" ranlib "\$@"
EOF
  chmod +x "$d"/tivibro-*
  export PATH="$d:$PATH"
  CC_W="tivibro-$ARCH_NAME-cc"; AR_W="tivibro-$ARCH_NAME-ar"; RANLIB_W="tivibro-$ARCH_NAME-ranlib"

  # strip / nm that understand the target ELF.
  if command -v "${BU_PREFIX}strip" >/dev/null; then
    STRIP="${BU_PREFIX}strip"; NM="${BU_PREFIX}nm"
  elif command -v llvm-strip >/dev/null; then
    STRIP=llvm-strip; NM=llvm-nm
  else
    die "need ${BU_PREFIX}strip (apt: binutils-${BU_PREFIX%-}) or llvm-strip"
  fi
}

# ---------------------------------------------------------------- sources
FF_TARBALL="$CACHE_DIR/ffmpeg-$FFMPEG_VERSION.tar.xz"
MB_TARBALL="$CACHE_DIR/mbedtls-$MBEDTLS_VERSION.tar.bz2"

fetch_sources() {
  fetch "$FF_TARBALL" "$FFMPEG_SHA256" "$FFMPEG_URL" "$FFMPEG_MIRROR"
  if [ "$ENABLE_TLS" = 1 ]; then
    fetch "$MB_TARBALL" "$MBEDTLS_SHA256" "$MBEDTLS_URL" "$MBEDTLS_MIRROR"
  fi
}

# ---------------------------------------------------------------- mbedTLS
build_mbedtls() {
  local bdir="$1" prefix="$2"
  [ -f "$prefix/lib/libmbedtls.a" ] && return 0
  log "Building mbedTLS $MBEDTLS_VERSION ($ZTARGET)"
  rm -rf "$bdir" && mkdir -p "$bdir"
  tar xjf "$MB_TARBALL" -C "$bdir" --strip-components=1
  # Client-side TLS only: drop the parts ffmpeg never touches.  config.py
  # imports helpers from the bundled framework/ dir, so run it from the tree.
  local opt
  for opt in MBEDTLS_SSL_SRV_C MBEDTLS_DEBUG_C MBEDTLS_SELF_TEST MBEDTLS_TIMING_C \
             MBEDTLS_SSL_DTLS_HELLO_VERIFY MBEDTLS_SSL_DTLS_CLIENT_PORT_REUSE \
             MBEDTLS_SSL_DTLS_ANTI_REPLAY MBEDTLS_SSL_COOKIE_C MBEDTLS_SSL_TICKET_C \
             MBEDTLS_SSL_PROTO_DTLS MBEDTLS_PKCS7_C MBEDTLS_X509_CSR_PARSE_C \
             MBEDTLS_X509_CRL_PARSE_C MBEDTLS_NET_C; do
    ( cd "$bdir" && python3 scripts/config.py unset "$opt" ) || die "mbedTLS config.py unset $opt failed"
  done
  make -C "$bdir/library" -j"$JOBS" \
    CC="$CC_W" AR="$AR_W" \
    CFLAGS="-Os -ffunction-sections -fdata-sections" \
    libmbedcrypto.a libmbedx509.a libmbedtls.a
  mkdir -p "$prefix/lib" "$prefix/include"
  cp "$bdir"/library/libmbed*.a "$prefix/lib/"
  cp -R "$bdir/include/mbedtls" "$bdir/include/psa" "$prefix/include/"
}

# ---------------------------------------------------------------- ffmpeg
# Only what the helper needs.  Everything else stays disabled.
FF_COMPONENTS=(
  --enable-protocol=file,pipe,tcp,http
  --enable-demuxer=matroska,mov,mpegts,avi,flv
  --enable-decoder=dca,truehd,mlp,flac,ac3,eac3,aac,mp3,mp3float,mp2,mp2float,opus,vorbis,'pcm_*'
  --enable-encoder=ac3,eac3,aac
  --enable-parser=h264,hevc,av1,mpeg4video,mpegvideo,vp9,aac,aac_latm,ac3,dca,flac,mlp,mpegaudio,opus,vorbis
  --enable-bsf=h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc,extract_extradata,vp9_superframe,av1_frame_split
  --enable-muxer=matroska,mpegts,mp4,adts,null
  --enable-filter=aresample,aformat,anull,pan,abuffer,abuffersink,atrim,asetpts,anullsink
)

FF_BASE=(
  --enable-cross-compile --target-os=linux --pkg-config=false
  --disable-everything --disable-autodetect
  --disable-programs --enable-ffmpeg
  --disable-doc --disable-debug
  --enable-static --disable-shared
  --disable-avdevice --disable-swscale --disable-postproc
  --enable-avcodec --enable-avformat --enable-avfilter --enable-swresample
  --enable-network
  --disable-iconv --disable-zlib --disable-bzlib --disable-lzma
  --enable-small
)

build_ffmpeg() {
  local arch="$1"
  arch_vars "$arch"
  local base="$WORK_DIR/$arch" tc="$WORK_DIR/$arch/toolchain"
  make_wrappers "$tc"

  local tls_cflags="" tls_ldflags="" tls_opts=()
  if [ "$ENABLE_TLS" = 1 ]; then
    local mbp="$base/mbedtls-prefix"
    build_mbedtls "$base/mbedtls-src" "$mbp"
    # Relative to the ffmpeg tree (all compiles run from there), so the
    # configuration string embedded in the binary has no build-host paths.
    tls_cflags="-I../mbedtls-prefix/include"; tls_ldflags="-L../mbedtls-prefix/lib"
    # mbedTLS is Apache-2.0, which ffmpeg accepts only under (L)GPL v3.
    tls_opts=(--enable-mbedtls --enable-version3 --enable-protocol=https,tls)
  fi

  log "Configuring ffmpeg $FFMPEG_VERSION for $arch"
  local src="$base/ffmpeg"
  rm -rf "$src" && mkdir -p "$src"
  tar xJf "$FF_TARBALL" -C "$src" --strip-components=1

  local configure=(
    ./configure
    --prefix=/opt/tivibro-ffmpeg
    --arch="$FF_ARCH"
    --cc="$CC_W" --ar="$AR_W" --ranlib="$RANLIB_W"
    --nm="$NM" --strip="$STRIP"
    --extra-cflags="-ffunction-sections -fdata-sections $tls_cflags"
    --extra-ldflags="-static -Wl,--gc-sections $tls_ldflags"
    "${FF_BASE[@]}"
    "${FF_COMPONENTS[@]}"
    "${tls_opts[@]}"
  )
  ( cd "$src" && "${configure[@]}" ) || { tail -n 60 "$src/ffbuild/config.log" >&2; die "configure failed"; }

  log "Building ffmpeg for $arch ($JOBS jobs)"
  make -C "$src" -j"$JOBS" ffmpeg

  local bin="$OUT_DIR/tivibro-ffmpeg-$arch"
  "$STRIP" --strip-all -o "$bin" "$src/ffmpeg_g"
  chmod 755 "$bin"

  # Static, no interpreter: refuse to ship anything else.
  if command -v readelf >/dev/null && readelf -l "$bin" | grep -q 'INTERP'; then
    die "$bin has a program interpreter (not static)"
  fi

  cp "$src/LICENSE.md" "$OUT_DIR/LICENSE.md"
  cp "$src/COPYING.LGPLv2.1" "$OUT_DIR/COPYING.LGPLv2.1"
  cp "$src/COPYING.LGPLv3" "$OUT_DIR/COPYING.LGPLv3"
  if [ "$ENABLE_TLS" = 1 ]; then
    cp "$base/mbedtls-src/LICENSE" "$OUT_DIR/LICENSE.mbedtls.txt"
  fi

  local pretty_cfg
  # Shell-quoted for copy and paste, with single quotes only where needed.
  local arg pretty_cfg=""
  for arg in "${configure[@]}"; do
    if [[ "$arg" =~ ^[A-Za-z0-9_=,./:+-]+$ ]]; then pretty_cfg+="$arg "
    else pretty_cfg+="'${arg//\'/\'\\\'\'}' "; fi
  done
  {
    echo "TiviBro ffmpeg build ($arch)"
    echo
    echo "ffmpeg version: $FFMPEG_VERSION"
    echo "ffmpeg source:  $FFMPEG_URL"
    echo "ffmpeg sha256:  $FFMPEG_SHA256"
    if [ "$ENABLE_TLS" = 1 ]; then
      echo "mbedTLS version: $MBEDTLS_VERSION (Apache-2.0)"
      echo "mbedTLS source:  $MBEDTLS_URL"
      echo "mbedTLS sha256:  $MBEDTLS_SHA256"
      echo "license: LGPL v3 or later (ffmpeg --enable-version3, required for mbedTLS)"
    else
      echo "license: LGPL v2.1 or later"
    fi
    echo "toolchain: zig $ZIG_VERSION (clang + musl), target $ZTARGET, cpu $ZCPU"
    echo "build script: scripts/ffmpeg/build.sh in the TiviBro repository"
    echo
    echo "configure line ($CC_W = 'zig cc -target $ZTARGET -mcpu=$ZCPU', ar/ranlib = 'zig ar/ranlib',"
    echo "../mbedtls-prefix = mbedTLS built with scripts/ffmpeg/build.sh):"
    echo "$pretty_cfg"
  } > "$OUT_DIR/SOURCE-$arch.txt"

  log "Done: $bin ($(stat -c %s "$bin") bytes)"
}

# ---------------------------------------------------------------- smoke test
# Needs on the host: qemu-arm(-static)/qemu-aarch64(-static), ffmpeg + ffprobe
# with the (experimental) dca encoder, python3 for a local HTTP server.
qemu_for() {
  local q
  for q in "qemu-$1-static" "qemu-$1"; do
    command -v "$q" >/dev/null && { echo "$q"; return 0; }
  done
  die "qemu-$1-static not found (apt: qemu-user-static)"
}

# probe <file> <stream-selector> <entry>
probe() {
  local out
  out="$(ffprobe -v error -select_streams "$2" -show_entries "stream=$3" -of default=nw=1:nk=1 "$1" || true)"
  echo "${out%%$'\n'*}"
}

expect() {  # expect <what> <got> <want>
  if [ "$2" = "$3" ]; then echo "  ok: $1 = $2"; else echo "  FAIL: $1 = '$2', expected '$3'" >&2; return 1; fi
}

check_output() {  # check_output <file> <audio codec> <video codec>
  local f="$1"
  [ -s "$f" ] || { echo "  FAIL: $f missing or empty" >&2; return 1; }
  expect "$(basename "$f") audio codec" "$(probe "$f" a:0 codec_name)" "$2"
  expect "$(basename "$f") audio channels" "$(probe "$f" a:0 channels)" 6
  expect "$(basename "$f") video codec" "$(probe "$f" v:0 codec_name)" "$3"
  local dur
  dur="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f")"
  python3 -c 'import sys; d=float(sys.argv[1]); sys.exit(0 if 9.0 <= d <= 11.0 else 1)' "$dur" \
    && echo "  ok: $(basename "$f") duration $dur" \
    || { echo "  FAIL: $(basename "$f") duration $dur" >&2; return 1; }
}

make_fixtures() {
  local d="$1"
  [ -s "$d/dts51.mkv" ] && return 0
  mkdir -p "$d"
  log "Generating 10 s DTS 5.1 + H.264 fixture with host ffmpeg"
  local vcodec=(-c:v libx264 -preset ultrafast -pix_fmt yuv420p)
  # (Captured, not piped into grep -q: with pipefail an early grep exit is a failure.)
  local host_enc; host_enc="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
  grep -q ' libx264 ' <<<"$host_enc" || vcodec=(-c:v mpeg4)
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=320x180:rate=25:duration=10" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=10" \
    -filter_complex "[1:a]pan=5.1(side)|FL=c0|FR=0.8*c0|FC=0.6*c0|LFE=0.3*c0|SL=0.5*c0|SR=0.4*c0[a]" \
    -map 0:v -map "[a]" "${vcodec[@]}" \
    -c:a dca -strict -2 -b:a 1509k \
    "$d/dts51.mkv"
  # TrueHD fixture too, when the host encoder cooperates (also experimental).
  ffmpeg -hide_banner -loglevel error -y -i "$d/dts51.mkv" -map 0 -c:v copy \
    -c:a truehd -strict -2 "$d/truehd51.mkv" 2>/dev/null || rm -f "$d/truehd51.mkv"
  ffprobe -v error -show_entries stream=codec_name,channels -of compact "$d/dts51.mkv"
}

smoke_test() {
  local arch="$1" q bin="$OUT_DIR/tivibro-ffmpeg-$1" fx="$WORK_DIR/fixtures" t
  [ -x "$bin" ] || die "$bin not found; build it first"
  case "$arch" in armv7) q="$(qemu_for arm)" ;; aarch64) q="$(qemu_for aarch64)" ;; esac
  t="$WORK_DIR/test-$arch"; rm -rf "$t"; mkdir -p "$t"
  make_fixtures "$fx"
  local ff=("$q" "$bin" -hide_banner -nostdin -loglevel error -y)
  local fail=0

  log "[$arch] -version / component lists"
  local ver decs encs protos conf need
  ver="$("$q" "$bin" -version)" || die "[$arch] binary does not run under $q"
  echo "${ver%%$'\n'*}"
  decs="$("$q" "$bin" -hide_banner -decoders 2>/dev/null)"
  encs="$("$q" "$bin" -hide_banner -encoders 2>/dev/null)"
  protos="$("$q" "$bin" -hide_banner -protocols 2>/dev/null)"
  conf="$("$q" "$bin" -hide_banner -buildconf 2>/dev/null)"
  for need in dca truehd mlp flac ac3 eac3 aac mp3float opus vorbis pcm_s24le; do
    grep -qE "^ A[^ ]* +$need " <<<"$decs" || { echo "  FAIL: decoder $need missing" >&2; fail=1; }
  done
  for need in ac3 eac3 aac; do
    grep -qE "^ A[^ ]* +$need " <<<"$encs" || { echo "  FAIL: encoder $need missing" >&2; fail=1; }
  done
  local want_protos=(http pipe tcp file)
  [ "$ENABLE_TLS" = 1 ] && want_protos+=(https)
  for need in "${want_protos[@]}"; do
    grep -qx "  $need" <<<"$protos" || { echo "  FAIL: protocol $need missing" >&2; fail=1; }
  done
  if grep -qE -- '--enable-(gpl|nonfree)' <<<"$conf"; then
    echo "  FAIL: GPL or nonfree enabled" >&2; fail=1
  fi
  echo "  ok: components and license"

  log "[$arch] DTS 5.1 MKV -> AC-3 5.1 MKV (file)"
  "${ff[@]}" -i "$fx/dts51.mkv" -map 0 -c:v copy -c:a ac3 -b:a 640k "$t/ac3.mkv" || fail=1
  check_output "$t/ac3.mkv" ac3 "$(probe "$fx/dts51.mkv" v:0 codec_name)" || fail=1

  log "[$arch] DTS 5.1 from stdin (pipe:0) -> E-AC-3 MPEG-TS"
  "${ff[@]}" -f matroska -i pipe:0 -map 0 -c:v copy -c:a eac3 -b:a 640k -f mpegts "$t/eac3.ts" \
    < "$fx/dts51.mkv" || fail=1
  check_output "$t/eac3.ts" eac3 "$(probe "$fx/dts51.mkv" v:0 codec_name)" || fail=1

  log "[$arch] DTS 5.1 over HTTP -> fragmented MP4 to stdout (AC-3)"
  local port=$(( 20000 + RANDOM % 20000 ))
  python3 -I -m http.server "$port" --bind 127.0.0.1 --directory "$fx" >/dev/null 2>&1 &
  local srv=$!
  sleep 1
  "${ff[@]}" -i "http://127.0.0.1:$port/dts51.mkv" -map 0 -c:v copy -c:a ac3 \
    -f mp4 -movflags frag_keyframe+empty_moov+delay_moov pipe:1 > "$t/ac3.mp4" || fail=1
  kill "$srv" 2>/dev/null || true
  check_output "$t/ac3.mp4" ac3 "$(probe "$fx/dts51.mkv" v:0 codec_name)" || fail=1

  if [ -s "$fx/truehd51.mkv" ]; then
    log "[$arch] TrueHD 5.1 MKV -> E-AC-3 MKV"
    "${ff[@]}" -i "$fx/truehd51.mkv" -map 0 -c:v copy -c:a eac3 -b:a 768k "$t/truehd-eac3.mkv" || fail=1
    check_output "$t/truehd-eac3.mkv" eac3 "$(probe "$fx/dts51.mkv" v:0 codec_name)" || fail=1
  fi

  log "[$arch] stereo downmix (pan) -> AAC ADTS"
  "${ff[@]}" -i "$fx/dts51.mkv" -vn -af "pan=stereo|FL<FL+0.7*FC+0.7*SL|FR<FR+0.7*FC+0.7*SR" \
    -c:a aac -b:a 192k -f adts "$t/stereo.aac" || fail=1
  expect "stereo.aac channels" "$(probe "$t/stereo.aac" a:0 channels)" 2 || fail=1

  [ "$fail" = 0 ] || die "[$arch] smoke test FAILED"
  log "[$arch] smoke test passed"
}

if [ "$MODE" = test ]; then
  for a in "${ARCHES[@]}"; do smoke_test "$a"; done
  exit 0
fi

install_zig
fetch_sources
for a in "${ARCHES[@]}"; do build_ffmpeg "$a"; done
ls -l "$OUT_DIR"
