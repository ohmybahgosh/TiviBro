#!/usr/bin/env bash
# Launch TiviBro on the TV.   bash scripts/launch.sh [-d tv]
source "$(dirname "$0")/_common.sh"; parse_device "$@"
ares ares-launch $(device_args) "$APP_ID"
