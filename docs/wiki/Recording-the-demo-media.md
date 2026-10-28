Every GIF, video and TV screenshot in the README, the user guide and this wiki is recorded from the real app in headless Chromium, against the made-up provider in `tests/mock/mock_provider.js`.  After a UI change, re-record and everything stays current.

## Steps

```bash
bash scripts/demo/make-media.sh          # once: synthetic demo streams in tests/mock/media/
node tests/mock/mock_provider.js &       # fictional Xtream provider on :8077
npm run serve                            # app on :8078 plus the dev relay (and the editor on :8787)
node scripts/demo/record.js              # every scene, or name some: guide zap restore
                                         # (DEMO_APP=http://127.0.0.1:PORT/index.html for another app address)
bash scripts/demo/encode.sh              # GIFs and MP4s into docs/media/
node scripts/wiki/build.js               # refresh the wiki pages from the user guide
```

## How it works

- `record.js` runs each **scene** in a fresh browser at 1920x1080, with the clock fixed at 8:04pm so the guide looks like prime time.
- It seeds a demo playlist, favorites and a custom group, so scenes start from a realistic setup.  The `firstrun` and `restore` scenes start from a blank TV instead.
- A pill in the top right shows which remote button was pressed and what it does.
- `restore` and `live-edit` record two windows at once (a computer browser and the TV); `encode.sh` puts them side by side.
- Screenshots go to `docs/screenshots/`; raw recordings stay in `docs/media/raw/`, which is not committed.
- GIFs are sized for the README (800 px, or 720 px at 8 fps for scenes with full-screen video), with a full-quality MP4 beside each.

## Scenes

| Scene | Shows |
|---|---|
| `guide` | Browsing the guide, preview, fullscreen |
| `zap` | Channel up and down, info, quick menu, last channel, guide over video |
| `groups` | Groups beside the guide, the menu |
| `catchup` | Rewinding the guide and replaying a programme |
| `search` | Search as you type |
| `vod` | Movies, categories, shows, episodes |
| `multiview` | Two channels side by side |
| `settings` | Settings sections, live accent and background changes |
| `channels` | The Channels screen, channel options, copy to a group, Favorites |
| `versions` | Other versions of a channel, chosen by hand and in the quick menu |
| `reminders` | Setting a reminder, and the question when it starts |
| `parental` | Setting a PIN, blocking a channel, the PIN question |
| `options` | The Red options menu, stream info, sleep timer, picture size |
| `firstrun` | The first-run screen and setup from a computer |
| `restore` | Restoring a locked backup onto a brand-new TV |
| `live-edit` | Hiding groups in the editor while the TV follows |

Screenshot-only scenes (no video):

| Scene | Shows |
|---|---|
| `failover` | A channel that stops working switches to another version by itself (`tv-failover`) |
| `settings-pages` | Every Settings section and the pages inside them (`tv-set-*`) |
| `editor` | Every page of the web editor at 1440x860 (`editor-*`; `editor-smart-match` and `editor-guide-progress` need a provider whose guide is incomplete or slow, so they are kept from an earlier recording) |

The scenes find their way by watching where the focus is (the menu, a Settings section, a row, a menu item) rather than counting key presses, so small layout changes don't break them.
