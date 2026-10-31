# webOS TV 25 Simulator

Installed self-contained under `tools/` (git-ignored).  Nothing was installed system-wide and no root was used.

```
tools/
  downloads/webOS_TV_25_Simulator_1.4.4_linux.zip    original from LG (sha256 05725ceb5492b177...dc3e)
  webOS_TV_25_Simulator_1.4.4/
    webOS_TV_25_Simulator_1.4.4.AppImage             the simulator (Electron)
```

Source: https://webostv.developer.lge.com/develop/tools/simulator-installation (LG SDK license accepted 2026-10-25).
LG lists Ubuntu 16.04 to 22.04 for this version; it is a generic AppImage and normally runs on Debian too.

## Run it (on the desktop, not over SSH: it opens a window)

```bash
cd TiviBro           # your clone of this repository
npm run sim          # opens app/ in the simulator; edits to app/ auto-reload
                     # (runs the AppImage directly: ares-launch 3.2.6 only finds lowercase .appimage files)
npm run sim:open     # just open the simulator
```

If libfuse2 is missing, the script uses AppImage extract-and-run mode automatically.  To install FUSE instead: `sudo apt install libfuse2` (optional).

## Log file
While `npm run sim` runs, `scripts/logsink.js` listens on 127.0.0.1:47812 and the app streams every log line to it, including debug lines and each key press with the screen it happened on.
- `logs/latest.log`: the current run (overwritten each run).
- `logs/session-<date>-<time>.log`: one file per run, kept.
Credentials are masked by the app before sending.  Nothing listens on that port on a TV, so the TV build is unaffected.

## The network helper in the simulator
`npm run sim` now also starts the helper on this computer (port 47811), and the app uses it automatically when the webOS service isn't available.  So the network helper and the web editor (http://localhost:8787 on this computer) work in the simulator without extra steps.  The notes below are only needed if you want to test the real webOS service.

The app calls `luna://app.tivibro.tv.service/start`.  In the simulator, click **Service** on the remote panel (right side), choose the `service/` folder, make sure it is toggled on, then relaunch the app (**App** button or `npm run sim`).  Check Settings > Playback > Network helper.

If the simulator won't run the helper, use the desktop relay instead: run `node tests/mock/relay_dev.js` in a terminal, open the simulator's Inspector console and run
`localStorage.setItem('tivibro.devRelay','47811'); location.reload()`.
Remove it later with `localStorage.removeItem('tivibro.devRelay')`.

## What it does and doesn't prove
- Good for: webOS 25 Chromium compatibility, layout at 1920x1080, remote navigation (on-screen remote), settings, name editor, login and diagnostics, guide.
- Not proof of: real decoding and buffering smoothness, AC-3 audio, DRM/mediaOption.  LG says the simulator's video and audio differ from a TV.

## Uninstall
Delete `tools/webOS_TV_25_Simulator_1.4.4/` and `tools/downloads/`.  Extract-and-run mode may leave a temp copy under /tmp that clears on reboot.
