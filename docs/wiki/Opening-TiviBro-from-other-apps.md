<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*On the TV*

A home screen, a launcher, a script over SSH or Home Assistant can open TiviBro straight onto something: a channel, a team's game, the guide or another part of TiviBro, a search, a Settings section, or the last channel.  It works when TiviBro is closed (it opens it once the channels are in) and when it's already open (it comes to the front).

There are two ways to ask, with the same result:

- **Launch params:** launch `app.tivibro.tv` with `{"open":{"action":"channel","number":206}}`.
- **A link:** `{"contentTarget":"tivibro://team/nhl:det"}`.  LG's own deep links work the same way.

| Link | Opens |
|---|---|
| `tivibro://channel/206` | Channel 206.  A channel can also be found by guide id (`?epg=`) or by name (`?name=ESPN`), matched the way your channel list shows it. |
| `tivibro://team/nhl:det` | The Red Wings' game on now, for a team you follow in My teams.  `?start=` (ms) picks one of several.  When the game is on several channels and one doesn't start, the next is tried. |
| `tivibro://view/guide` | The guide.  Also `live`, `movies`, `shows`, `media`, `onnow`, `recordings`, `search` and `settings`. |
| `tivibro://search/lions` | Search, with "lions" typed in. |
| `tivibro://settings/recording` | Settings, on Recording and live pause. |
| `tivibro://last` | The channel you watched before. |

Over SSH:

```sh
luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"app.tivibro.tv","params":{"contentTarget":"tivibro://view/guide"}}'
```

Hidden channels are never opened, and locked ones still ask for the PIN.  Every action and field, with Home Assistant and webOS examples: [LAUNCH-API.md](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/LAUNCH-API.md).

---

← [Screensaver](Screensaver)  ·  [Home](Home)  ·  [Settings: Language](Settings-Language) →
