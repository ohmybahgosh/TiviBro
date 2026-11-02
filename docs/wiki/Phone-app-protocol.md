How the TiviBro phone app talks to TiviBro on the TV.  For anyone building or checking the Android app; [service/companion.js](https://github.com/ohmybahgosh/TiviBro/blob/main/service/companion.js) is the TV's side and [scripts/companion/tb-phone.js](https://github.com/ohmybahgosh/TiviBro/blob/main/scripts/companion/tb-phone.js) a complete client in Node.

## Where it runs

- Off until the user switches it on in TiviBro: **Settings > Phone app > Phone app connection**.
- While on, TiviBro's helper keeps running in the background, also when TiviBro is closed.  It listens on **TCP 47810** (the API, plain HTTP on the home network) and **UDP 47810** (discovery).  If 47810 is taken it uses 47816, 47817 or 47818, and says so in discovery.
- After the TV restarts, or if webOS stops it, the helper is back within 5 minutes (a persistent webOS activity calls it).  An install removes the package's own activity, so `install.sh` starts the helper again and adds a second 5-minute activity (`tivibro-keepalive`) that isn't part of the package; the helper ends either one when the connection is turned off.  `TIVIBRO_NO_KEEPALIVE=1` skips the second.

## Finding TVs

Send the text `tivibro-discover-v1` as a UDP broadcast to port 47810.  Each TV answers to the sender with JSON:

```json
{ "app": "TiviBro", "api": 1, "id": "3f9c0a7d12e4b6c8", "name": "Living room", "port": 47810, "version": "0.6.0-alpha.30" }
```

`GET /v1/hello` gives the same, plus `pairing` (whether the TV is showing a code right now) and `now` (the TV's clock, in ms).  Nothing else is open without pairing.

## Pairing

On the TV: **Settings > Phone app > Pair a phone**.  The TV shows a 12-character code (`XXXX-XXXX-XXXX`, letters and digits without 0, O, 1, I and L) and a QR code for 10 minutes.  The QR code is a link:

```
https://tivibro.app/pair#v=1&h=<ip>:<port>&id=<tv id>&c=<code>&n=<tv name>
```

Everything is after the `#`, so a phone camera opening it never sends the code to tivibro.app.  The page there opens the app when it is installed.

The code never crosses the network:

1. `code` = the code without dashes or spaces, in capitals.
2. `kp` = PBKDF2-SHA256(code, salt `tivibro-pair-v1:<tv id>`, 100,000 rounds, 32 bytes).
3. `POST /v1/pair` with `{ "nonce": <random, base64, 16 to 64 characters>, "phone": { "name", "model", "platform" }, "proof": hex HMAC-SHA256(kp, "tivibro-pair-v1\n<tv id>\n<nonce>\n<phone name>") }`.
4. The TV answers `{ "ok": true, "tv": { "id", "name", "api", "version" }, "phone": <phone id>, "key": { "iv", "data", "tag" }, "proof" }`.
   - Check `proof` = hex HMAC-SHA256(kp, "tivibro-paired-v1\n<phone id>\n<nonce>"): the TV knew the code too.
   - The phone's key is AES-256-GCM(kp, iv) with additional data `tivibro-key-v1\n<phone id>`: 32 random bytes.  Keep it in the phone's secure storage, out of backups.

Errors (JSON `{ "error", "code" }`): `closed` (no code on the TV, it ran out, or it already paired a phone), `wrong` (with `left`, tries left), `full` (12 phones already), `busy` (too many tries from this address in a minute).  Five wrong codes end that code.

## Signed requests

Every other call carries four headers:

| Header | Value |
|---|---|
| `X-TiviBro-Phone` | the phone id |
| `X-TiviBro-Time` | ms, on the TV's clock (keep the difference to `now` from hello) |
| `X-TiviBro-Nonce` | random, base64, 16 to 64 characters, new for every request |
| `X-TiviBro-Sig` | hex HMAC-SHA256(key, "tivibro-req-v1\n<METHOD>\n<path with query>\n<time>\n<nonce>\n<hex SHA-256 of the body>") |

The TV refuses a time more than 5 minutes off (`clock`, with its `now`), a nonce it has seen (`replay`), a bad signature (`signature`) and a phone it doesn't know (`unpaired`).  Every answer to a known phone carries `X-TiviBro-Sig` = hex HMAC-SHA256(key, "tivibro-res-v1\n<nonce>\n<status>\n<hex SHA-256 of the body>"); drop answers without it.  The one the TV can't sign is `unpaired` (it no longer has the key): say so, but let the user decide to pair again, since anyone on the network could send it.

| Call | Answer |
|---|---|
| `GET /v1/info` | name, `model`, `webos`, `version`, `mac` (for Wake-on-LAN), `ips`, `tivibro: { open, visible, editor }` |
| `POST /v1/open` | opens TiviBro on the TV |
| `POST /v1/editor` | `{ "state": "ready", "url" }`: the web editor, signed in for this phone (open it in a WebView).  `starting`: TiviBro is opening or starting it; ask again every two seconds. |
| `POST /v1/forget` | removes this phone from the TV |

## Remote and Play on TV

All signed like the calls above.  TiviBro carries out each command once; if TiviBro is closed, a command opens it and waits for it (up to 40 seconds).

| Call | Body | What it does |
|---|---|---|
| `POST /v1/key` | `{ "key": "ok" }` | A remote button: `ok`, `hold` (OK held), `up`, `down`, `left`, `right`, `back`, `chup`, `chdown`, `playpause`, `stop`, `rew`, `ff`, `info`, `red`, `green`, `yellow`, `blue`, `num0` to `num9`. |
| `POST /v1/action` | `{ "action": "guide" }` | Straight to: `guide`, `search`, `settings`, `live`, `movies`, `shows`, `last`, `fav`, `favorites`, `recents`, `audio`, `picture`, `exit`, `restart`, `reconnect`, `list`, `panel`, `osd`, `menu`. |
| `POST /v1/play` | `{ "k": "<channel key>" }` | Plays that channel full screen. |
| `POST /v1/text` | `{ "text": "michigan" }` | Searches for it on the TV. |
| `POST /v1/volume` | `{ "dir": "up" }` | The TV's own volume: `up`, `down`, `mute`.  Works with TiviBro closed.  Answers `{ "volume": { "level", "muted" } }`. |
| `GET /v1/state?since=<rev>&wait=1` | | What TiviBro shows: `{ rev, open, state: { tab, full, playing: { k, name, num, logo, group }, now: { t, s, e }, next, paused, vod } }`.  With `wait=1` and the current `rev`, the TV answers when it changes, or after 20 seconds. |
| `GET /v1/lineup?rev=<rev>` | | The channel list as TiviBro shows it: `{ rev, groups: [{ id, name, keys }], channels: [{ k, n, num, logo, fav, now, na }] }` (`na: 1`: a channel only a group shows, not All).  `pending: true` while TiviBro is making it (ask again in a second), `same: true` when `rev` is current, `closed: true` when TiviBro is closed. |

## Questions for TiviBro

`POST /v1/ask` with `{ "what": "...", "args": { ... } }`, signed like every call.  TiviBro on the TV answers (it is opened first when closed), and the phone waits for it: `{ ok: true, data }`.  TiviBro's own refusals come back as `409` with `code: "tv"` and a reason to show.  `{ pending: true }` means TiviBro didn't answer in time (it may still be opening); ask again.  With `"noOpen": true` and TiviBro closed, the answer is `{ closed: true }` and nothing opens (the app's automatic backups).

| what | args | data |
|---|---|---|
| `guide` | `group` (a group id from the lineup, empty for all), `at` (ms, default now), `offset`, `limit` (up to 200) | `{ total, offset, pending, rows: [{ k, a (catch-up), p: [{ t, s, e, r (reminder set) }] }] }`: what is on at `at` and the two after.  A row without `p` is still loading on the TV (`pending` counts them); ask again. |
| `schedule` | `k` | `{ k, arch (catch-up days), progs: [{ t, s, e, d (description), r }], descPending }`: from as far back as catch-up goes to a week ahead. |
| `remind` | `k`, `s` (the programme's start), `on` | `{ on }`.  The TV's own reminder, shown also while TiviBro is closed. |
| `fav` | `k`, `on` | `{ on }`.  The lineup follows. |
| `vis` | `op` `list` with `group` (blank: the channel `k`'s own group), or `save` with `group` and `changes` (`{ key: true (show) or false (hide) }`) | `list`: `{ group, title, rows: [{ k, n, num, logo, on, g }] }`, every channel of the group, hidden ones too (`on` 0), `g` 1 when it has guide data.  `save`: `{ msg }`; the lineup follows. |
| `chan` | `k`, `op` (`info`, `hide` with `on`, `rename` with `name` (empty: the provider's), `group` with `group` and `on`, `newgroup` with `name`, `follow` with `on`: follow the team whose channel it is, for My teams) | `{ k, name, provider, renamed, hidden, group, groups: [{ id, name, has }], team: { id, name, on } or null, msg }`: the channel after the change.  The lineup follows. |
| `settings` (sealed) | `op`: `sections`, `page` (`sec`, `path`: the page rows followed in), `toggle` (`i`, `on`), `choice` (`i`, `v`: the choice's index), `cycle` (`i`, `dir`), `action` (`i`); `pin` when Settings is locked | `{ sections: [{ id, title }] }`, a page `{ title, trail, rows: [{ i, kind, label, sub, value, on, options, cur, swatch }] }` (kind: `head`, `info`, `toggle`, `choice`, `cycle`, `page`, `action`), or after a change `{ msg, page }`.  `{ locked: true, msg }` when the TV's PIN is needed or wrong. |
| `vodcats` | `kind` (`movie`, `series`, or `media` for My media) | `{ cats: [{ id, n, count, adult, locked }] }`, or `{ none: true }` when the playlist has none (for `media`: no My media sources).  `_all` is All movies or All shows, `_cw` Continue watching, `_my` My list.  My media's are `continue`, `favorites` and `all`.  `voditems`, `vodinfo` and `vodplay` take `kind: 'media'` the same way; a My media movie plays from the TV's My media screen. |
| `voditems` | `kind`, `cat` or `q` (search), `offset`, `limit` (up to 300) | `{ total, offset, items: [{ id, n, c (cover), r (rating), y (year), p (percent watched) }] }`, `locked: true` for a category behind the PIN. |
| `vodinfo` | `kind`, `id` | A movie: `{ id, n, c, plot, genre, cast, year, dur, r, media, pos, len }` (`pos` and `len` in seconds, where it stopped).  A show: `{ id, n, c, plot, genre, cast, year, r, seasons: [{ s, eps: [{ id, e, t, dur, plot, pos, len }] }] }`. |
| `vodplay` | `kind`, `id`, `ep` (an episode id, for a show), `fromStart` | `{ title }`.  Plays it on the TV (from where it stopped unless `fromStart`). |
| `input` | `id` (from the state's `inputs`), `value`, `submit` | `{ ok }`.  Types into a text box on the TV's screen; `submit` saves a rename box. |
| `playlist` | `link` (the provider's full link), `name`, `use` (switch to it) | `{ msg }`.  Adds the playlist like the web editor's Add a playlist. |
| `backup` | | `{ backup }`: everything (settings, every playlist with its login, edits, restore points), the same as the web editor's backup before it is sealed with a passphrase. |
| `restore` | `backup` | `{ playlists }`.  TiviBro restarts with it. |
| `logs` (sealed) | | `{ text }`: TiviBro's log, the app's (this and earlier sessions) and the network helper's, as **Report a problem** makes it: provider, guide and server names replaced.  The last 600,000 characters. |

`GET /v1/state` also lists the text boxes on the TV's screen: `state.inputs: [{ id, label, type (text, url or password), value, has (a password is filled in), submit, focus }]`.  A password's text is never sent.

### Sealed requests

`playlist`, `input`, `backup`, `restore`, `settings` and `logs` are refused unless sealed, since they carry logins or private details.  A sealed request's body is `{ "sealed": { iv, data, tag } }`: the question, AES-256-GCM encrypted under `HMAC-SHA256(key, "tivibro-seal-v1")` with additional data `tivibro-seal-req-v1\n<phone id>\n<nonce>` (the request's own nonce, so a sealed body can't be moved to another request).  The answer to a sealed request is sealed the same way with `tivibro-seal-res-v1\n<phone id>\n<nonce>`; errors from before the TV could open the request come back plain.  The signature covers the sealed body as sent.

## Waking the TV

When the TV is off nothing answers.  Send Wake-on-LAN magic packets to the `mac` from info (broadcast, UDP 9), every few seconds until hello answers.  The TV needs **Turn on via Wi-Fi** (or **Mobile TV On**) switched on.
