#!/bin/sh
# Rooted TVs only, run as root (by install.sh, or by the helper through the Homebrew Channel).
# A TiviBro installed in developer mode gets only the "public" permission group, so the TV refuses
# the helper two read-only questions it needs for reminders and diagnostics:
#   com.webos.service.tvpower/power/getPowerState          (is the screen on, or the screensaver / Always Ready?)
#   com.webos.applicationManager/getForegroundAppInfo      (which app is in front?)
# This adds the two groups that allow them (tv.management, applications.internal) to TiviBro's own
# permissions, nothing else, and asks the TV to reload them.  Safe to run again.  Every install
# writes the TV's files for TiviBro afresh, so it runs again after an install or update.
# webOS 3 and older (no manifests) are left alone.
D="${TIVIBRO_LS2_DEV:-/var/luna-service2-dev}"
M="$D/manifests.d/app.tivibro.tv.json"
P="$D/client-permissions.d/app.tivibro.tv.service.perms.json"
[ -f "$M" ] || { echo "skipped: no permissions manifest"; exit 0; }
echo '{"app.tivibro.tv.service*":["tv.management","applications.internal"]}' > "$P" || { echo "failed: can't write $P"; exit 1; }
node -e "var fs = require('fs'), f = process.argv[1], p = process.argv[2], m = JSON.parse(fs.readFileSync(f, 'utf8'));
if (!Array.isArray(m.clientPermissionFiles)) m.clientPermissionFiles = [];
if (m.clientPermissionFiles.indexOf(p) < 0) { m.clientPermissionFiles.push(p); fs.writeFileSync(f, JSON.stringify(m)); }" "$M" "$P" || { echo "failed: manifest not updated"; exit 1; }
[ -n "${TIVIBRO_LS2_DEV:-}" ] || ls-control scan-services >/dev/null 2>&1 || true
echo granted
