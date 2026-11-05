#!/usr/bin/env bash
# Package app/ + service/ into dist/<id>_<version>_all.ipk, then verify it.
#   bash scripts/build.sh           minified (release)
#   bash scripts/build.sh --dev     unminified (readable in ares-inspect)
source "$(dirname "$0")/_common.sh"
MIN=""; [ "${1:-}" = "--dev" ] && MIN="--no-minify"
SVC_ID="$(node -p "require('$ROOT/service/services.json').id")"
SVC_VER="$(node -p "require('$ROOT/service/package.json').version")"
[ "$SVC_VER" = "$VERSION" ] || { echo "Version mismatch: app $VERSION, service $SVC_VER (run scripts/bump-version.sh)" >&2; exit 1; }
case "$SVC_ID" in "$APP_ID".*) ;; *) echo "Service id $SVC_ID must start with $APP_ID." >&2; exit 1;; esac
# The web editor (served by the helper) uses the same name clean-up and Smart clean-up engines as the app.
cp "$ROOT/app/js/names.js" "$ROOT/service/editor/names.js"
cp "$ROOT/app/js/tidy.js" "$ROOT/service/editor/tidy.js"
cp "$ROOT/app/js/pubepg.js" "$ROOT/service/editor/pubepg.js"
cp "$ROOT/app/js/links.js" "$ROOT/service/editor/links.js"
cp "$ROOT/app/js/events.js" "$ROOT/service/editor/events.js"
cp "$ROOT/app/js/vodview.js" "$ROOT/service/editor/vodview.js"   # the helper keeps the movie and show lists (service/vod.js)
cp "$ROOT/app/js/plshape.js" "$ROOT/service/editor/plshape.js"   # the helper shapes the channel list (service/live.js)
rm -rf "$ROOT/service/guide-data" "$ROOT/service/power.json" "$ROOT/service/reminders.json" "$ROOT/service/helper-errors.json" "$ROOT/service/companion.json" "$ROOT/service/companion.json.tmp" "$ROOT"/service/alert-*.json                                # guides stored by a dev relay: not for the package     # the helper's guide reader matches with it
cp "$ROOT/app/img/tmdb.svg" "$ROOT/service/editor/tmdb.svg"          # the web editor's TMDB credit (My media)
bash "$ROOT/scripts/ffmpeg/bundle.sh"                              # the audio converter rides along (docs/FFMPEG.md)
mkdir -p "$ROOT/dist"
echo "Packaging $APP_ID $VERSION ${MIN:+(dev, unminified)}"
STAGE="$(mktemp -d)"; T="$(mktemp -d)"; trap 'rm -rf "$STAGE" "$T"' EXIT
stage_app "$STAGE"                                                 # app/ with hashed script names (_common.sh)
ares ares-package $MIN -o "$ROOT/dist" "$STAGE/app" "$ROOT/service"
[ -f "$IPK" ] || { echo "Expected $IPK was not produced" >&2; exit 1; }
# Verify layout: app, service and package manifest all present.
( cd "$T" && ar x "$IPK" && tar xzf data.tar.gz )
for p in "usr/palm/applications/$APP_ID/appinfo.json" "usr/palm/services/$SVC_ID/services.json" "usr/palm/packages/$APP_ID/packageinfo.json"; do
  [ -f "$T/$p" ] || { echo "IPK is missing $p" >&2; exit 1; }
done
if grep -oiE "<script[^>]*[[:space:]]src[[:space:]]*=[[:space:]]*[\"'][^\"']*" "$T/usr/palm/applications/$APP_ID/index.html" | grep -vE '\.[0-9a-f]{10}\.js$' | grep -viE "[\"']([a-z]+:)?//"; then
  echo "IPK index.html loads the scripts above under their plain names" >&2; exit 1
fi
echo "OK  $(du -h "$IPK" | cut -f1)  $IPK"
