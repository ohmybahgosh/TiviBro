# Opening TiviBro onto something (launch API)

Any home screen, launcher, script or home automation can open TiviBro straight onto a channel, a team's game, the guide, a search and more.  It works when TiviBro is closed (it starts and opens it once the channels are in) and when it's already running (it comes to the front and opens it).  The code is `app/js/launch.js`.

There are two ways to ask.  Both give the same result.

## 1. Launch params

Launch the app `app.tivibro.tv` with params:

```json
{ "open": { "action": "channel", "number": 206 } }
```

From a shell on the TV (SSH, or a script):

```sh
luna-send -n 1 luna://com.webos.applicationManager/launch \
  '{"id":"app.tivibro.tv","params":{"open":{"action":"team","id":"nhl:det"}}}'
```

From another webOS app, use the same call with `webOS.service.request` / `PalmServiceBridge`.

## 2. A deep link

For launchers and LG features that only pass one string, TiviBro takes a `tivibro://` link as `contentTarget` (its `appinfo.json` declares `deeplinkingParams`):

```json
{ "contentTarget": "tivibro://team/nhl:det?start=1795216200000" }
```

`params.uri` and `params.open` also take a link, and so does a launch whose params are just the link as text.

A link maps one-to-one onto the `open` object:

- The first part of the path is the action.
- A second part is the action's main field: `id` for team, `q` for channel and search, `name` for view, `section` for settings.
- The query string carries the other fields.

| Link | Same as |
|---|---|
| `tivibro://channel/206` | `{"action":"channel","q":"206"}` |
| `tivibro://channel?name=ESPN` | `{"action":"channel","name":"ESPN"}` |
| `tivibro://team/nhl:det?start=1795216200000` | `{"action":"team","id":"nhl:det","start":"1795216200000"}` |
| `tivibro://view/guide` | `{"action":"view","name":"guide"}` |
| `tivibro://search/detroit%20lions` | `{"action":"search","q":"detroit lions"}` |

## Actions

| Action | Fields | What it does |
|---|---|---|
| `channel` | `key`, `number`, `epg`, `name`, or `q` | Plays the channel, full screen.  The fields are tried in that order, so give one.  `q` tries each in turn: key, then number (digits), then guide id, then name. |
| `team` | `id`, optional `start`, optional `title` | Plays a followed team's game.  `id` is a My teams id, `league:abbr` in lower case, for example `nhl:det`, `nfl:det`, `mlb:det`, `ncaaf:mich` or `ncaaf:msu`.  It picks the game on now.  With `start` (ms since 1970) it picks the game starting closest to that.  A game more than 5 minutes away asks first.  `title` is only used in messages. |
| `view` | `name` | Opens a part of TiviBro: `live` (channels), `guide`, `movies`, `shows`, `media` (My media), `onnow` (Movies on now), `sports` (Sports), `recordings`, `search` or `settings`. |
| `guide` | none | The guide.  Same as `view` with `guide`. |
| `search` | `q` | Search, with the words already typed in. |
| `settings` | `section` | Settings, opened on a section: for example `keys`, `recording`, `guide`, `media`, `playback` or `about`. |
| `last` | none | The channel watched before. |
| `reminder` | `pid`, `k`, `s` | What the TV's reminder alert sends with Watch.  Launchers don't need it. |

**How channels are matched:**

- `number` is the channel number shown in the lists.
- `epg` is the guide id (tvg-id), compared ignoring case, including a guide channel you picked yourself.
- `name` is compared the way the channel list shows names: with your renames and the playlist's name rules, ignoring case, accents, spaces and punctuation.  An exact match wins over one that starts with the name, which wins over one that contains it.  Among equal matches, a Favorite comes first.
- Hidden channels are never opened.  Locked ones ask for the PIN as usual.

If nothing matches, TiviBro shows a short message and stays where it was.  An unknown action says TiviBro may need an update, so a launcher can add actions from newer versions safely.

## Examples

**Home Assistant** (LG webOS TV integration):

```yaml
action: webostv.command
target:
  entity_id: media_player.lg_tv
data:
  command: system.launcher/launch
  payload:
    id: app.tivibro.tv
    params:
      contentTarget: "tivibro://team/nfl:det"
```

**A home screen tile** (JavaScript on webOS):

```js
webOS.service.request('luna://com.webos.applicationManager', {
  method: 'launch',
  parameters: { id: 'app.tivibro.tv', params: { open: { action: 'channel', name: 'ESPN' } } }
});
```

**Over SSH**, the guide:

```sh
luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"app.tivibro.tv","params":{"contentTarget":"tivibro://view/guide"}}'
```
