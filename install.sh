#!/bin/sh
# TiviBro installer for rooted LG webOS TVs.  Run it on the TV, over SSH or Telnet:
#
#   curl -fsSL https://tivibro.app/install | sh       (or https://raw.githubusercontent.com/ohmybahgosh/TiviBro/homebrew/install.sh)
#
# Options (after "sh -s --" when piped, or directly when run from a file):
#   (no option)        newest full release; until there is one, the newest test version
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
# webOS 4 (Node 0.12) can run it.  Source: scripts/tv/install.sh (published with every release, and on the homebrew branch).
set -e

REPO="${TIVIBRO_REPO:-ohmybahgosh/TiviBro}"
BASE="${TIVIBRO_BASE:-https://github.com/$REPO/releases}"
API="${TIVIBRO_API:-https://api.github.com/repos/$REPO/releases?per_page=100}"
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

# One Luna call; prints the reply.  Root can use the private bus (luna-send), which newer TVs need
# for the application manager: there luna-send-pub gets "Denied method call" (seen on webOS 25).
# Falls back to the public bus when there is no luna-send or it refuses.  Input comes from /dev/null:
# run as "curl ... | sh", the script itself arrives on stdin, and luna-send given that pipe answers
# nothing at all (seen on webOS 25).
luna() {   # luna URI JSON
  if command -v luna-send >/dev/null 2>&1; then
    R="$(luna-send -n 1 "$1" "$2" </dev/null 2>/dev/null || true)"
    case "$R" in *'"returnValue":true'*|*'"returnValue": true'*) echo "$R"; return 0 ;; esac
  fi
  luna-send-pub -n 1 "$1" "$2" </dev/null 2>/dev/null || true
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
  if [ "$PRE" = 0 ] && [ -z "$TAG" ] && ! fetch "$BASE/latest/download/$MANIFEST_NAME" "$WORK/latest.json" 2>/dev/null; then
    say "No full release yet; using the newest test version"
    PRE=1
  fi
  if [ "$PRE" = 1 ] && [ -z "$TAG" ]; then
    say "Looking up the newest release, test versions included"
    fetch "$API" "$WORK/releases.json" || die "Could not reach GitHub.  Is the repository public?"
    # Newest by date: GitHub lists releases by tag name, so v0.6.0-alpha.9 comes before v0.6.0-alpha.10.
    TAG="$(json "$WORK/releases.json" "(j.filter(function (r) { return !r.draft && (r.assets || []).some(function (a) { return a.name === process.argv[2]; }); }).sort(function (a, b) { var x = a.published_at || a.created_at || '', y = b.published_at || b.created_at || ''; return x < y ? 1 : x > y ? -1 : 0; })[0] || {}).tag_name" "$MANIFEST_NAME")"
    [ -n "$TAG" ] || die "No release with a TiviBro manifest found."
  fi
  if [ -n "$TAG" ]; then MURL="$BASE/download/$TAG/$MANIFEST_NAME"; else MURL="$BASE/latest/download/$MANIFEST_NAME"; fi
  say "Reading ${TAG:-the latest release}"
  fetch "$MURL" "$WORK/manifest.json" || die "Could not download $MURL  (is the repository public?)"
  # Test builds have a numeric package version (0.5.10005); the tag says what it is (0.6.0-alpha.5).
  if [ -n "$TAG" ]; then VERSION="${TAG#v}"; else VERSION="$(json "$WORK/manifest.json" "j.version")"; fi
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

OLD="$(luna 'luna://com.webos.applicationManager/getAppInfo' "{\"id\":\"$APP_ID\"}" \
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
# Install numbers (tivibro.app/stats): the version and whether it was a new install or an update, nothing
# else.  TIVIBRO_NO_COUNT=1 skips it.
if [ -z "${TIVIBRO_NO_COUNT:-}" ] && command -v curl >/dev/null 2>&1; then
  KIND=install; [ -n "$OLD" ] && KIND=update
  curl -fsS -m 5 -X POST -H 'Content-Type: application/json' -d "{\"e\":\"$KIND\",\"v\":\"$VERSION\"}" https://tivibro-report.theboxmod.workers.dev/count >/dev/null 2>&1 || true
fi
# The phone app connection: an install removes the helper's own restart schedule and stops it, so the
# phone couldn't reach the TV until TiviBro was opened again.  When the connection is on, start the
# helper now (it schedules its own check again) and add a check every 5 minutes that belongs to the
# TV, not to the TiviBro package, so an update from the Homebrew Channel app can't remove it.  The
# helper ends that check itself once the phone app connection is turned off.  TIVIBRO_NO_KEEPALIVE=1
# skips the second part.
SVC_DIR="${TIVIBRO_SVC_DIR:-/media/developer/apps/usr/palm/services/$APP_ID.service}"
if grep -q '"on":true' "$SVC_DIR/companion.json" 2>/dev/null; then
  luna "luna://$APP_ID.service/wake" '{}' >/dev/null
  if [ -z "${TIVIBRO_NO_KEEPALIVE:-}" ]; then
    luna 'luna://com.palm.activitymanager/create' "{\"activity\":{\"name\":\"tivibro-keepalive\",\"description\":\"TiviBro: keep the phone app connection up (added by install.sh)\",\"type\":{\"background\":true,\"persist\":true,\"explicit\":true},\"schedule\":{\"interval\":\"5m\"},\"callback\":{\"method\":\"luna://$APP_ID.service/wake\",\"params\":{}}},\"start\":true,\"replace\":true}" >/dev/null
  fi
  echo "[*] Phone app connection restarted."
fi
if [ "$LAUNCH" = 1 ]; then
  # The reply says whether it worked; the command's exit code does not.
  case "$(luna 'luna://com.webos.applicationManager/launch' "{\"id\":\"$APP_ID\"}")" in
    *'"returnValue":true'*|*'"returnValue": true'*) echo "[*] Starting TiviBro." ;;
    *) echo "[*] The TV would not start it from here.  Open TiviBro from the app list." ;;
  esac
fi
