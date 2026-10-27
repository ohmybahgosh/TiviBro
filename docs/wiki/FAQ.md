**Does TiviBro come with channels?**
No.  TiviBro is a player.  You need your own subscription: an Xtream Codes login or an M3U playlist address.

**Is it really free?**
Yes.  No accounts, no ads, no tracking, MIT licensed.

**Which TVs work?**
LG TVs with webOS 6 or newer.  It is tested in the webOS 25 Simulator and on real TVs as testing goes on.

**Is it a TiviMate port?**
No.  It is built from scratch for webOS, with the TiviMate way of working in mind: guide first, preview then fullscreen, quick menu, groups beside the guide.  See [TiviMate parity](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/TIVIMATE-PARITY.md) for a feature-by-feature list.

**Does it play 4K, HDR and Dolby Vision?**
Yes, as far as your TV and provider do.  Dolby Vision goes through the TV's own player, which switches the screen into Dolby Vision; HDR10 and HLG play in TiviBro's built-in player unless you choose otherwise under **Settings > Playback and buffering > HDR and Dolby Vision**.  **Settings > Diagnostics > What this TV can play** lists what your TV handles.  See [Watching fullscreen](Watching-fullscreen).

**Why is there no sound on some movies?**
LG TVs from 2020, 2021 and 2022 (the C1 and C2 among them) can't decode DTS.  TiviBro warns you in the movie details; pick another audio track under **Options** if the movie has one.

**Can I use more than one playlist?**
Yes.  **Settings > Playlists and guide > Add playlist…**.  Each playlist keeps its own groups, favorites, hidden items, names and guide setup.

**Does it work with Dispatcharr or other proxies?**
Yes.  Use the proxy's address as the server (Xtream) or playlist address (M3U).

**Why does TiviBro need a "network helper"?**
webOS apps can't talk to most IPTV servers directly because of browser security rules.  A small helper service inside the app relays those requests on the TV itself, and can send a custom User-Agent when your provider asks for one.  Nothing leaves your TV except the requests to your own provider.

**My provider has a guide, but some channels say "No guide information".**
See [The programme guide](The-programme-guide).  Smart match in the web editor usually fixes most of them in one go.

**Can my backup be read by someone else?**
Not without your passphrase.  See [Backup and restore](Backup-and-restore) and [Privacy and security](Privacy-and-security).

**Multiview shows one channel and a black screen.**
Many TVs can only decode two streams at once, and some providers allow one connection.  Try two screens, and check your provider's connection limit (shown under **Settings > Playlists and guide**).

**Something else?**
Try [Troubleshooting](Troubleshooting), or open an [issue](https://github.com/ohmybahgosh/TiviBro/issues) with a copy of **Settings > Diagnostics > View app log** (it hides usernames and passwords).
