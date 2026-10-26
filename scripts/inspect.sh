#!/usr/bin/env bash
# Open Chrome DevTools against the app on the TV.  Add -s to inspect the network helper service instead.
source "$(dirname "$0")/_common.sh"
SVC=0; while getopts "d:s" o; do case $o in d) DEVICE="$OPTARG";; s) SVC=1;; esac; done
if [ $SVC = 1 ]; then ares ares-inspect $(device_args) --service "$APP_ID.service" --open
else ares ares-inspect $(device_args) --app "$APP_ID" --open; fi
