#!/bin/sh
# The remote's Guide button opens TiviBro (Settings > Remote and buttons > The TV's Guide button).  Rooted TVs only,
# run as root by the helper through the Homebrew Channel.  The button belongs to the TV: webOS opens its own guide
# (com.webos.app.livemenu, launched with reason "hotKey") before any app hears it.  The watcher below follows the
# TV's app events and, when that happens, closes LG's guide and opens TiviBro on its guide.  Nothing of LG's is
# changed on disk; a boot hook in the Homebrew Channel's init.d starts the watcher again after a restart.
#
#   install   the boot hook, and the watcher started now          remove   the hook gone, the watcher stopped
#   status    prints "on" (hook there) or "off"                    run      the watcher itself (from the hook)
R="${TIVIBRO_GK_ROOT:-}"          # tests: everything under a folder of their own
HOOK=$R/var/lib/webosbrew/init.d/02-tivibro-guide-key
SELF="$(cd "$(dirname "$0")" && pwd)/guidekey.sh"
PIDFILE=$R/tmp/tivibro-guide-key.pid
LOG=$R/tmp/tivibro-guide-key.log
LGGUIDE=com.webos.app.livemenu
TIVIBRO=app.tivibro.tv

# The watcher of an earlier hand-made setup (Nov 28, /media/developer/guide-tivibro) would open TiviBro twice.
old() {
  rm -f $R/var/lib/webosbrew/init.d/02-guide-tivibro
  [ -f $R/tmp/guide-tivibro.pid ] && kill "$(cat $R/tmp/guide-tivibro.pid)" 2>/dev/null
  [ -z "$R" ] && pkill -f "[g]uide-tivibro.sh" 2>/dev/null
  rm -f $R/tmp/guide-tivibro.pid
}
stop() { [ -f $PIDFILE ] && kill "$(cat $PIDFILE)" 2>/dev/null; [ -z "$R" ] && pkill -f "[g]uidekey.sh run" 2>/dev/null; rm -f $PIDFILE; }

case "$1" in
install)
  old
  mkdir -p "$(dirname $HOOK)" || { echo "failed: no init.d"; exit 1; }
  # The hook runs this file from TiviBro's helper folder, and does nothing once TiviBro is uninstalled.
  printf '#!/bin/sh\n# Added by TiviBro: the remote'"'"'s Guide button opens TiviBro.  Turn it off in TiviBro (Settings > Remote and buttons).\n[ -f "%s" ] && (nohup sh "%s" run >/dev/null 2>&1 &)\nexit 0\n' "$SELF" "$SELF" > $HOOK || { echo "failed: hook not written"; exit 1; }
  chmod 755 $HOOK
  stop
  (nohup sh "$SELF" run >/dev/null 2>&1 &)
  echo on
  ;;
remove)
  old; rm -f $HOOK; stop
  echo off
  ;;
status)
  [ -f $HOOK ] && echo on || echo off
  ;;
run)
  if [ -f $PIDFILE ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then exit 0; fi
  echo $$ > $PIDFILE
  [ -f $LOG ] && [ "$(wc -c < $LOG)" -gt 100000 ] && : > $LOG
  echo "$(date '+%m-%d %H:%M:%S') watching" >> $LOG
  while [ -f "$SELF" ] && [ -f $HOOK ]; do
    luna-send -i luna://com.webos.service.applicationmanager/getAppLifeEvents '{"subscribe":true}' 2>/dev/null |
    while read -r line; do
      case "$line" in *'"event":"launch"'*'"appId":"'$LGGUIDE'"'*'"reason":"hotKey"'*) ;; *) continue ;; esac
      [ -f $HOOK ] || exit 0
      echo "$(date '+%m-%d %H:%M:%S') Guide button -> TiviBro" >> $LOG
      luna-send -n 1 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$LGGUIDE\"}" >/dev/null 2>&1
      luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$TIVIBRO\",\"params\":{\"open\":{\"action\":\"guide\"}}}" >/dev/null 2>&1
    done
    sleep 2
  done
  rm -f $PIDFILE
  ;;
*) echo "usage: $0 install | remove | status | run"; exit 2 ;;
esac
