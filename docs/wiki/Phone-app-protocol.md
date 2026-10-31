How the TiviBro phone app talks to TiviBro on the TV.  For anyone building or checking the Android app; [service/companion.js](https://github.com/ohmybahgosh/TiviBro/blob/main/service/companion.js) is the TV's side and [scripts/companion/tb-phone.js](https://github.com/ohmybahgosh/TiviBro/blob/main/scripts/companion/tb-phone.js) a complete client in Node.

## Where it runs

- Off until the user switches it on in TiviBro: **Settings > Phone app > Phone app connection**.
- While on, TiviBro's helper keeps running in the background, also when TiviBro is closed.  It listens on **TCP 47810** (the API, plain HTTP on the home network) and **UDP 47810** (discovery).  If 47810 is taken it uses 47816, 47817 or 47818, and says so in discovery.
- After the TV restarts, the helper is back within 15 minutes (a persistent webOS activity calls it).

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

## Waking the TV

When the TV is off nothing answers.  Send Wake-on-LAN magic packets to the `mac` from info (broadcast, UDP 9), every few seconds until hello answers.  The TV needs **Turn on via Wi-Fi** (or **Mobile TV On**) switched on.
