#!/usr/bin/env bash
# Install the current dist IPK on the TV.   bash scripts/install.sh [-d tv]
source "$(dirname "$0")/_common.sh"; parse_device "$@"
[ -f "$IPK" ] || bash "$ROOT/scripts/build.sh"
ares ares-install $(device_args) "$IPK"
