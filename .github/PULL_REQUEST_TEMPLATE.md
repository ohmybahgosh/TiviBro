## What this changes

<!-- One or two sentences.  Link the issue it fixes: "Fixes #12". -->

## Why

<!-- The problem it solves, from the viewer's side: what was wrong or missing on the TV or in the editor. -->

## How it was tested

<!-- What you ran and on what.  Tick what applies. -->

- [ ] `npm run lint` and `npm test` pass
- [ ] Tried on a real LG TV (model and webOS version: )
- [ ] Tried in the webOS Simulator or `npm run serve`
- [ ] Old TVs: `bash tests/engines/run.sh browser` (Chromium 53 to 87) for app changes
- [ ] The soak test for the area, if there is one (`npm run soak:tour`, `soak:editor`, `soak:editor-mobile`, `soak:events`...)

## Screenshots or a video

<!-- For anything you can see.  A phone photo of the TV is fine. -->

## Checklist

- [ ] App code still parses on Chromium 53 (webOS 4): no CSS grid, no Unicode property classes in regular expressions; see docs/COMPATIBILITY.md
- [ ] Works with the remote alone (arrows, OK, Back), and with the Magic Remote
- [ ] CHANGELOG.md has a line under "## Unreleased" for anything a viewer would notice
- [ ] The user guide (docs/USER-GUIDE.md) covers new settings or screens
- [ ] No logins, server addresses or stream links anywhere: code, tests, screenshots, logs
