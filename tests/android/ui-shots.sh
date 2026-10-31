#!/usr/bin/env bash
# The phone app on an Android emulator, against the stand-in TV (tests/android/fake-tv.js on the host,
# which the emulator reaches as 10.0.2.2): starts it empty, pairs through the tivibro.app/pair link,
# opens the web editor, and saves a screenshot of each.  Fails if the app crashes.
#   bash tests/android/ui-shots.sh <apk> <out dir> <fake-tv line host:port:CODE:TVID>
set -euo pipefail
APK=$1; OUT=$2; IFS=: read -r _ PORT CODE TVID <<< "$3"
PKG=app.tivibro.phone
mkdir -p "$OUT"
shot() { sleep "${2:-4}"; w=$(find_text "Wait"); [ -n "$w" ] && { adb shell input tap $w; sleep 2; }; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }
# The emulator's own apps sometimes stall on a slow CI machine ("Pixel Launcher isn't responding"):
# answer Wait, so the dialog doesn't cover TiviBro.
calm() { adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true; }
find_text() {   # centre of the first element whose text is $1, or nothing
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1
  python3 - "$1" "$OUT/ui.xml" <<'PY'
import re,sys
t,f=sys.argv[1],open(sys.argv[2]).read()
m=re.search(r'text="'+re.escape(t)+r'"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',f)
print('' if not m else '%d %d'%((int(m[1])+int(m[3]))//2,(int(m[2])+int(m[4]))//2))
PY
}
tap() {   # tap the first element whose text is $1
  local b=""
  for i in 1 2 3 4 5; do
    w=$(find_text "Wait"); [ -n "$w" ] && { adb shell input tap $w; sleep 2; }
    calm
    b=$(find_text "$1"); [ -n "$b" ] && break
    sleep 3
  done
  [ -n "$b" ] || { echo "no \"$1\" on screen"; adb exec-out screencap -p > "$OUT/fail.png"; adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -3; return 1; }
  adb shell input tap $b
}
sleep 25; calm      # let the freshly booted emulator settle
adb install -r "$APK"
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity
shot 1-empty 5
adb shell am start -W -a android.intent.action.VIEW -d "tivibro://pair?v=1\&h=10.0.2.2%3A$PORT\&id=$TVID\&c=$CODE\&n=Fake%20TV" $PKG
shot 2-paired 8
tap "Edit channels"
shot 3-editor 10
adb shell input keyevent KEYCODE_BACK
sleep 3
[ -n "$(find_text "Edit channels")" ] || { echo "Back did not return to the TV list"; adb exec-out screencap -p > "$OUT/fail.png"; adb logcat -d > "$OUT/logcat.txt"; grep -E "TiviBroBack|ActivityTaskManager|wm_|$PKG|FATAL" "$OUT/logcat.txt" | tail -60; exit 1; }
echo "Back returns to the TV list"
if adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime: Process: $PKG" ; then echo "The app crashed"; adb logcat -d | grep -A30 "FATAL EXCEPTION" | head -60; exit 1; fi
echo "no crashes"
