#!/bin/sh
# Rooted TVs: shows a reminder alert (Watch / Dismiss) as root, run by the helper through the Homebrew
# Channel.  The TV only takes alerts from LG's own apps, but one sent with root's luna-send is allowed.
# The alert itself is in alert-<n>.json beside this script, written by the helper (remind.js), and is
# passed to luna-send as one argument: no programme or channel name ever reaches a command line.
# The only argument is <n>, digits only; or "close <alert id>" to take the alert down again after a few seconds.
if [ "$1" = close ]; then
  case "$2" in ''|*[!A-Za-z0-9._-]*) echo "bad id"; exit 1 ;; esac
  exec luna-send -n 1 -w 5000 luna://com.webos.notification/closeAlert "{\"alertId\":\"$2\"}"
fi
case "$1" in ''|*[!0-9]*) echo "bad id"; exit 1 ;; esac
F="$(dirname "$0")/alert-$1.json"
[ -f "$F" ] || { echo "no alert"; exit 1; }
J="$(cat "$F")"
rm -f "$F"
luna-send -n 1 -w 5000 luna://com.webos.notification/createAlert "$J"
