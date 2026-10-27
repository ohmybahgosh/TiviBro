#!/bin/sh
# TiviBro installer for rooted LG webOS TVs.  Run it on the TV, over SSH or Telnet:
#
#   curl -fsSL https://github.com/ohmybahgosh/TiviBro/releases/latest/download/install.sh | sh
#
# Options (after "sh -s --" when piped, or directly when run from a file):
#   --pre              newest release, test versions (alpha, beta) included
#   --tag vX.Y.Z       that release
#   --ipk FILE|URL     this IPK: a file already on the TV, or a download link
#   --sha256 HASH      expected SHA-256 for --ipk (releases are always checked against their manifest)
#   --no-launch        don't start TiviBro afterwards
# Example:  curl -fsSL .../install.sh | sh -s -- --pre
#
# Downloads the release's Homebrew Channel manifest and IPK, checks the IPK's SHA-256, installs it
# with the TV's own installer (com.webos.appInstallService) and starts TiviBro.  Updating keeps all
# settings.  Plain POSIX sh for the TV's BusyBox; JSON is read with the TV's own node, in ES5 so
# webOS 4 (Node 0.12) can run it.  Source: scripts/tv/install.sh (published as a release asset).
set -e

REPO="${TIVIBRO_REPO:-ohmybahgosh/TiviBro}"
BASE="${TIVIBRO_BASE:-https://github.com/$REPO/releases}"
API="${TIVIBRO_API:-https://api.github.com/repos/$REPO/releases?per_page=15}"
APP_ID=app.tivibro.tv
MANIFEST_NAME="$APP_ID.manifest.json"
WORK="${TMPDIR:-/tmp}/tivibro-install.$$"
IPK="$WORK/tivibro.ipk"
LAUNCH=1; TAG=""; PRE=0; SRC=""; SUM=""; VERSION=""

say() { echo "[ ] $*"; }
die() { echo "[!] $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --pre) PRE=1 ;;
    --tag) TAG="${2:?--tag needs a value}"; shift ;;
    --ipk) SRC="${2:?--ipk needs a file or link}"; shift ;;
    --sha256) SUM="${2:?--sha256 needs a value}"; shift ;;
    --no-launch) LAUNCH=0 ;;
    -h|--help) echo "Usage: install.sh [--pre | --tag vX.Y.Z | --ipk FILE|URL [--sha256 HASH]] [--no-launch]"; exit 0 ;;
    *) die "Unknown option: $1  (try --help)" ;;
  esac
  shift
done

command -v luna-send-pub >/dev/null 2>&1 || die "luna-send-pub not found.  Run this on the TV itself (SSH or Telnet), not on a computer."
command -v node >/dev/null 2>&1 || die "node not found on this TV."
[ "$(id -u 2>/dev/null)" = "0" ] || echo "[!] Not running as root.  On a Developer Mode TV, install from a computer with ares-install instead."

fetch() {  # fetch URL FILE
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 2 -o "$2" -- "$1"
  else wget -q -O "$2" "$1"; fi
}
json() {   # json FILE 'expression of j' [extra argument, as process.argv[2]]
  node -e "var j = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); var r = ($2); if (r != null && r !== '') console.log(r);" "$1" "${3:-}"
}

rm -rf "$WORK"; mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT INT TERM

if [ -n "$SRC" ]; then
  case "$SRC" in
    http://*|https://*) say "Downloading $SRC"; fetch "$SRC" "$IPK" || die "Download failed." ;;
    *) [ -f "$SRC" ] || die "No such file: $SRC"; cp "$SRC" "$IPK" ;;
  esac
  VERSION="from $(basename "$SRC")"
else
  if [ "$PRE" = 1 ] && [ -z "$TAG" ]; then
    say "Looking up the newest release, test versions included"
    fetch "$API" "$WORK/releases.json" || die "Could not reach GitHub.  Is the repository public?"
    TAG="$(json "$WORK/releases.json" "(j.filter(function (r) { return !r.draft && (r.assets || []).some(function (a) { return a.name === process.argv[2]; }); })[0] || {}).tag_name" "$MANIFEST_NAME")"
    [ -n "$TAG" ] || die "No release with a TiviBro manifest found."
  fi
  if [ -n "$TAG" ]; then MURL="$BASE/download/$TAG/$MANIFEST_NAME"; else MURL="$BASE/latest/download/$MANIFEST_NAME"; fi
  say "Reading ${TAG:-the latest release}"
  fetch "$MURL" "$WORK/manifest.json" || die "Could not download $MURL  (is the repository public?)"
  VERSION="$(json "$WORK/manifest.json" "j.version")"
  IPK_URL="$(json "$WORK/manifest.json" "require('url').resolve(process.argv[2], j.ipkUrl)" "$MURL")"
  SUM="$(json "$WORK/manifest.json" "j.ipkHash && j.ipkHash.sha256")"
  [ -n "$IPK_URL" ] && [ -n "$SUM" ] || die "The manifest is missing the IPK link or its SHA-256."
  say "Downloading TiviBro $VERSION"
  fetch "$IPK_URL" "$IPK" || die "Download failed: $IPK_URL"
fi

if [ -n "$SUM" ]; then
  if command -v sha256sum >/dev/null 2>&1; then GOT="$(sha256sum "$IPK" | cut -d' ' -f1)"
  else GOT="$(node -e "var h = require('crypto').createHash('sha256'); h.update(require('fs').readFileSync(process.argv[1])); console.log(h.digest('hex'));" "$IPK")"; fi
  [ "$GOT" = "$SUM" ] || die "Checksum mismatch (expected $SUM, got $GOT).  Not installing."
  say "Checksum OK"
fi

OLD="$(luna-send-pub -n 1 'luna://com.webos.applicationManager/getAppInfo' "{\"id\":\"$APP_ID\"}" 2>/dev/null \
  | node -e "var s = ''; process.stdin.on('data', function (d) { s += d; }); process.stdin.on('end', function () { try { console.log(JSON.parse(s).appInfo.version || ''); } catch (e) {} });" 2>/dev/null || true)"
[ -z "$OLD" ] || say "Installed now: $OLD"

say "Installing…"
FIFO="$WORK/luna"
mkfifo "$FIFO"
luna-send-pub -w 120000 -i 'luna://com.webos.appInstallService/dev/install' "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$IPK\",\"subscribe\":true}" > "$FIFO" &
LUNA_PID=$!
if ! RESULT="$(grep -m 1 -e 'installed' -e 'failed' -e '"returnValue": *false' "$FIFO")"; then
  kill -TERM "$LUNA_PID" 2>/dev/null || true
  die "No answer from the TV's installer."
fi
kill -TERM "$LUNA_PID" 2>/dev/null || true
case "$RESULT" in
  *installed*) ;;
  *) die "Install failed: $RESULT" ;;
esac

echo
echo "[*] TiviBro $VERSION installed.${OLD:+  (was $OLD)}"
if [ "$LAUNCH" = 1 ]; then
  luna-send-pub -n 1 'luna://com.webos.applicationManager/launch' "{\"id\":\"$APP_ID\"}" >/dev/null 2>&1 && echo "[*] Starting TiviBro." || true
fi
