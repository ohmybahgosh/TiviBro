#!/usr/bin/env bash
# Build tivibro-smb, the small static SMB2/3 reader My media uses for Windows and Samba shares on LG
# webOS TVs (scripts/smb/tivibro-smb.c on libsmb2, LGPL-2.1).  See docs/SMB.md.
#
# Usage:
#   scripts/smb/build.sh <armv7|aarch64|host|all> [out-dir]
#   scripts/smb/build.sh test <armv7|aarch64|host|all> [out-dir]
#
# "all" is armv7 and aarch64 (what the TVs run).  "host" builds for this computer, for the helper's tests.
# "test" starts a throwaway Samba server on 127.0.0.1 (needs smbd and smbpasswd) and checks the built
# programs against it (armv7 and aarch64 through qemu-user): shares, folders, a signed read compared byte
# for byte, an encrypted share, a wrong password, a missing share and a guest share.
#
# Output (default out-dir: $RUNNER_TEMP or $TMPDIR or /tmp, + /tivibro-smb/out):
#   <out-dir>/tivibro-smb-<arch>      stripped static program
#   <out-dir>/SOURCE-smb-<arch>.txt   libsmb2 commit, build flags, where the source is
#
# Toolchain: the same pinned Zig (clang + musl) as scripts/ffmpeg/build.sh, for fully static ARM programs
# that run on every webOS TV from webOS 4 on.  libsmb2 comes from git at a pinned commit, checked after
# checkout, so a moved tag can never change what gets built.
#
# Environment overrides (all optional):
#   LIBSMB2_REPO / LIBSMB2_COMMIT     where libsmb2 comes from and the exact commit
#   ZIG_VERSION / ZIG_WHEEL_SHA256    ziglang wheel for x86_64 Linux hosts
#   CACHE_DIR / WORK_DIR / JOBS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# libsmb2 after 6.0.0 (Dec 2024): 6.0.0's built-in SMB3 encryption fails against Samba 4.19 and its
# signing is about seven times slower; this commit fixes both and adds ARMv8 AES for 64-bit TVs.
LIBSMB2_REPO="${LIBSMB2_REPO:-https://github.com/sahlberg/libsmb2.git}"
LIBSMB2_COMMIT="${LIBSMB2_COMMIT:-ef32cff6cdda24279eaac802f468d9290a2c8b5d}"
ZIG_VERSION="${ZIG_VERSION:-0.14.1}"
ZIG_WHEEL_SHA256="${ZIG_WHEEL_SHA256:-6eb9d4d759b292c83810dbee2e9e8e3fbfbf01d864e6e9811bae711fd74e1c2f}"

BASE_TMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tivibro-smb"
CACHE_DIR="${CACHE_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tivibro-ffmpeg/cache}"   # shares zig with the ffmpeg build
WORK_DIR="${WORK_DIR:-$BASE_TMP/work}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"

log() { printf '\n==> %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

MODE=build
if [ "${1:-}" = test ]; then MODE=test; shift; fi
OUT_DIR="${2:-$BASE_TMP/out}"
case "${1:-}" in
  armv7|aarch64|host) ARCHES=("$1") ;;
  all) ARCHES=(armv7 aarch64) ;;
  *) usage ;;
esac
mkdir -p "$CACHE_DIR" "$WORK_DIR" "$OUT_DIR"
CACHE_DIR="$(cd "$CACHE_DIR" && pwd)"; WORK_DIR="$(cd "$WORK_DIR" && pwd)"; OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# ---------------------------------------------------------------- toolchain (as scripts/ffmpeg/build.sh)
install_zig() {
  ZIG_HOME="$CACHE_DIR/zig-$ZIG_VERSION"
  ZIG="$ZIG_HOME/ziglang/zig"
  [ -x "$ZIG" ] && return 0
  [ "$(uname -m)" = x86_64 ] || die "the pinned zig wheel is for x86_64 hosts; set ZIG_VERSION/ZIG_WHEEL_SHA256 for $(uname -m)"
  log "Installing zig $ZIG_VERSION (PyPI wheel)"
  local whl_dir="$CACHE_DIR/zig-wheel"
  rm -rf "$whl_dir" && mkdir -p "$whl_dir"
  printf 'ziglang==%s --hash=sha256:%s\n' "$ZIG_VERSION" "$ZIG_WHEEL_SHA256" > "$whl_dir/req.txt"
  python3 -m pip download --quiet --no-deps --only-binary=:all: --require-hashes -r "$whl_dir/req.txt" -d "$whl_dir"
  rm -rf "$ZIG_HOME" && mkdir -p "$ZIG_HOME"
  python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$(ls "$whl_dir"/ziglang-*.whl)" "$ZIG_HOME"
  chmod +x "$ZIG"
}

# Per-arch: zig target and CPU (the same baselines as the ffmpeg build), and a strip for the target ELF.
arch_vars() {
  case "$1" in
    armv7)   ZTARGET=arm-linux-musleabihf; ZCPU=cortex_a9+neon; BU_PREFIX=arm-linux-gnueabihf- ;;
    aarch64) ZTARGET=aarch64-linux-musl;   ZCPU=cortex_a53;     BU_PREFIX=aarch64-linux-gnu- ;;
    host)    ZTARGET=x86_64-linux-musl;    ZCPU=baseline;       BU_PREFIX= ;;
  esac
}

# A compiler wrapper cmake can use, with its own zig cache so parallel builds don't collide.
make_wrapper() {
  local d="$1"
  mkdir -p "$d"
  cat > "$d/cc" <<EOF
#!/bin/sh
export ZIG_GLOBAL_CACHE_DIR="$CACHE_DIR/zig-global-cache" ZIG_LOCAL_CACHE_DIR="$d/zig-cache"
exec "$ZIG" cc -target $ZTARGET -mcpu=$ZCPU "\$@"
EOF
  printf '#!/bin/sh\nexec "%s" ar "$@"\n' "$ZIG" > "$d/ar"
  printf '#!/bin/sh\nexec "%s" ranlib "$@"\n' "$ZIG" > "$d/ranlib"
  chmod +x "$d/cc" "$d/ar" "$d/ranlib"
  if command -v "${BU_PREFIX}strip" >/dev/null; then STRIP="${BU_PREFIX}strip"
  elif command -v llvm-strip >/dev/null; then STRIP=llvm-strip
  else die "need ${BU_PREFIX}strip (apt: binutils-${BU_PREFIX%-}) or llvm-strip"; fi
}

# ---------------------------------------------------------------- libsmb2 at its pinned commit
fetch_libsmb2() {
  SRC="$CACHE_DIR/libsmb2"
  if [ ! -d "$SRC/.git" ]; then
    log "Cloning libsmb2"
    git clone --quiet "$LIBSMB2_REPO" "$SRC"
  fi
  if [ "$(git -C "$SRC" rev-parse HEAD)" != "$LIBSMB2_COMMIT" ]; then
    git -C "$SRC" fetch --quiet origin || true
    git -C "$SRC" -c advice.detachedHead=false checkout --quiet "$LIBSMB2_COMMIT" || die "libsmb2 commit $LIBSMB2_COMMIT not found"
  fi
  [ "$(git -C "$SRC" rev-parse HEAD)" = "$LIBSMB2_COMMIT" ] || die "libsmb2 is not at $LIBSMB2_COMMIT"
}

# The library only: no Kerberos (NTLMv2 is what homes and NAS boxes use), no QUIC, RDMA, OpenSSL or the
# full DCE/RPC library, and size-optimised.
build_one() {
  local arch="$1"; local b="$WORK_DIR/$arch"
  arch_vars "$arch"
  make_wrapper "$b/bin"
  log "Building libsmb2 $LIBSMB2_COMMIT for $arch ($ZTARGET)"
  rm -rf "$b/lib" && mkdir -p "$b/lib"
  cmake -S "$SRC" -B "$b/lib" -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DCMAKE_C_COMPILER="$b/bin/cc" -DCMAKE_AR="$b/bin/ar" -DCMAKE_RANLIB="$b/bin/ranlib" \
    -DCMAKE_C_FLAGS="-Os -ffunction-sections -fdata-sections" \
    -DBUILD_SHARED_LIBS=OFF -DENABLE_EXAMPLES=OFF -DENABLE_UTILS=OFF -DENABLE_LIBKRB5=OFF -DENABLE_GSSAPI=OFF \
    -DENABLE_LIBDCERPC=OFF -DENABLE_LIBQUIC=OFF -DENABLE_RDMA=OFF -DENABLE_OPENSSL=OFF >"$b/cmake.log" 2>&1 \
    || { tail -30 "$b/cmake.log"; die "cmake failed for $arch"; }
  cmake --build "$b/lib" --target smb2 -j "$JOBS" >"$b/make.log" 2>&1 || { tail -30 "$b/make.log"; die "libsmb2 build failed for $arch"; }
  local lib; lib="$(find "$b/lib" -name libsmb2.a | head -1)"
  [ -n "$lib" ] || die "no libsmb2.a for $arch"
  "$b/bin/cc" -Os -static -Wall -Wextra -ffunction-sections -fdata-sections -Wl,--gc-sections \
    -I "$SRC/include" -o "$OUT_DIR/tivibro-smb-$arch" "$SCRIPT_DIR/tivibro-smb.c" "$lib"
  "$STRIP" "$OUT_DIR/tivibro-smb-$arch"
  cat > "$OUT_DIR/SOURCE-smb-$arch.txt" <<EOF
tivibro-smb for $arch ($ZTARGET, -mcpu=$ZCPU), built $(date -u +%Y-%m-%d)
Program source: scripts/smb/tivibro-smb.c in https://github.com/ohmybahgosh/TiviBro (MIT)
libsmb2 (LGPL-2.1): $LIBSMB2_REPO at commit $LIBSMB2_COMMIT
Built without Kerberos, OpenSSL, QUIC, RDMA and libdcerpc; statically linked with musl (MIT) by Zig $ZIG_VERSION.
To rebuild or relink with a changed libsmb2: scripts/smb/build.sh $arch
EOF
  log "tivibro-smb-$arch: $(stat -c %s "$OUT_DIR/tivibro-smb-$arch") bytes"
}

# ---------------------------------------------------------------- test against a throwaway Samba
run_for() {   # run_for <arch> <args...>: the built program, through qemu-user for ARM
  local arch="$1"; shift
  case "$arch" in
    armv7) qemu-arm-static "$OUT_DIR/tivibro-smb-armv7" "$@" ;;
    aarch64) qemu-aarch64-static "$OUT_DIR/tivibro-smb-aarch64" "$@" ;;
    host) "$OUT_DIR/tivibro-smb-host" "$@" ;;
  esac
}

start_samba() {
  command -v smbd >/dev/null && command -v smbpasswd >/dev/null || die "test needs smbd and smbpasswd (apt: samba)"
  T="$WORK_DIR/samba"
  rm -rf "$T" && mkdir -p "$T"/{media/Movies,guest,enc,priv,lock,state,cache,log,pid,ncalrpc}
  head -c 9000000 /dev/urandom > "$T/media/Movies/Film (2020).mkv"
  cp "$T/media/Movies/Film (2020).mkv" "$T/enc/film.mkv"
  echo hello > "$T/guest/a.txt"
  chmod -R a+rX "$T/media" "$T/guest" "$T/enc"
  SMB_PORT="${SMB_PORT:-4455}"
  cat > "$T/smb.conf" <<EOF
[global]
  server role = standalone server
  map to guest = Bad User
  server min protocol = SMB2_02
  server signing = mandatory
  smb ports = $SMB_PORT
  interfaces = lo
  bind interfaces only = yes
  disable netbios = yes
  private dir = $T/priv
  lock directory = $T/lock
  state directory = $T/state
  cache directory = $T/cache
  pid directory = $T/pid
  ncalrpc dir = $T/ncalrpc
  log file = $T/log/%m.log
[media]
  path = $T/media
  read only = yes
  valid users = tbtest
[enc]
  path = $T/enc
  read only = yes
  valid users = tbtest
  smb encrypt = required
[guest]
  path = $T/guest
  read only = yes
  guest ok = yes
EOF
  id tbtest >/dev/null 2>&1 || useradd -M tbtest 2>/dev/null || die "test needs a local user tbtest (useradd)"
  printf 'pass word1\npass word1\n' | smbpasswd -c "$T/smb.conf" -s -a tbtest >/dev/null
  smbd -D -s "$T/smb.conf"
  for _ in $(seq 1 20); do [ -f "$T/pid/smbd.pid" ] && break; sleep 0.5; done
  sleep 1
}
stop_samba() { [ -f "$T/pid/smbd.pid" ] && kill "$(cat "$T/pid/smbd.pid")" 2>/dev/null || true; }

test_one() {
  local arch="$1" S="127.0.0.1:$SMB_PORT" L=$'tbtest\npass word1\n' fails=0 got
  ok() { if [ "$2" = 1 ]; then echo "PASS $arch: $1"; else echo "FAIL $arch: $1  ${3:-}"; fails=$((fails + 1)); fi; }
  got="$(printf '%s' "$L" | run_for "$arch" check "$S" media)"
  ok "signs in (signing required)" "$([[ "$got" == *'"ok":true'* ]] && echo 1)" "$got"
  got="$(printf '%s' "$L" | run_for "$arch" shares "$S")"
  ok "lists disk shares" "$([[ "$got" == *'"media"'* && "$got" == *'"guest"'* && "$got" != *IPC* ]] && echo 1)" "$got"
  got="$(printf '%s' "$L" | run_for "$arch" ls "$S" media /Movies/)"
  ok "lists a folder" "$([[ "$got" == *'"name":"Film (2020).mkv","dir":false,"size":9000000'* ]] && echo 1)" "$got"
  got="$(printf '%s' "$L" | run_for "$arch" cat "$S" media "Movies/Film (2020).mkv" 0 -1 | sha256sum | cut -c1-64)"
  ok "reads a whole file" "$([ "$got" = "$(sha256sum < "$T/media/Movies/Film (2020).mkv" | cut -c1-64)" ] && echo 1)"
  got="$(printf '%s' "$L" | run_for "$arch" cat "$S" media "Movies/Film (2020).mkv" 1234567 2000001 | sha256sum | cut -c1-64)"
  ok "reads a range" "$([ "$got" = "$(tail -c +1234568 "$T/media/Movies/Film (2020).mkv" | head -c 2000001 | sha256sum | cut -c1-64)" ] && echo 1)"
  got="$(printf '%s' "$L" | run_for "$arch" cat "$S" enc film.mkv 0 -1 | sha256sum | cut -c1-64)"
  ok "reads from a share that requires encryption" "$([ "$got" = "$(sha256sum < "$T/enc/film.mkv" | cut -c1-64)" ] && echo 1)"
  got="$(printf 'tbtest\nwrong\n\n' | run_for "$arch" check "$S" media 2>&1 >/dev/null || true)"
  ok "a wrong password says login" "$([[ "$got" == *'"error":"login"'* ]] && echo 1)" "$got"
  got="$(printf '%s' "$L" | run_for "$arch" check "$S" nosuch 2>&1 >/dev/null || true)"
  ok "a missing share says noshare" "$([[ "$got" == *'"error":"noshare"'* ]] && echo 1)" "$got"
  got="$(printf '%s' "$L" | run_for "$arch" stat "$S" media nope.mkv 2>&1 >/dev/null || true)"
  ok "a missing file says notfound" "$([[ "$got" == *'"error":"notfound"'* ]] && echo 1)" "$got"
  got="$(printf '%s' "$L" | run_for "$arch" check 127.0.0.1:1 media 2>&1 >/dev/null || true)"
  ok "no server says unreachable" "$([[ "$got" == *'"error":"unreachable"'* ]] && echo 1)" "$got"
  return "$fails"
}

install_zig
fetch_libsmb2
if [ "$MODE" = build ]; then
  for a in "${ARCHES[@]}"; do build_one "$a"; done
else
  for a in "${ARCHES[@]}"; do [ -x "$OUT_DIR/tivibro-smb-$a" ] || build_one "$a"; done
  start_samba
  trap stop_samba EXIT
  total=0
  for a in "${ARCHES[@]}"; do test_one "$a" || total=$((total + $?)); done
  [ "$total" = 0 ] && echo "all tivibro-smb checks passed" || die "$total tivibro-smb checks failed"
fi
