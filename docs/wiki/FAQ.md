**Does TiviBro come with channels?**
No.  TiviBro is a player.  You need your own subscription: an Xtream Codes login or an M3U playlist address.

**Is it really free?**
Yes.  No accounts, no ads, no tracking, MIT licensed.  The only thing TiviBro sends about itself is an anonymous daily count of TVs by version, which you can switch off ([details](Privacy-and-security#install-numbers)).

**Which TVs work?**
LG TVs from webOS 4 (2018) to webOS 26.  webOS 25 is the main target and is tested in the webOS 25 Simulator; older versions share the same code with fallbacks.  See [webOS compatibility](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/COMPATIBILITY.md).

**Is it a TiviMate port?**
No.  It is built from scratch for webOS, with the TiviMate way of working in mind: guide first, preview then fullscreen, quick menu, groups beside the guide.  See [TiviMate parity](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/TIVIMATE-PARITY.md) for a feature-by-feature list.

**Does it play 4K, HDR and Dolby Vision?**
Yes, as far as your TV and provider do.  Dolby Vision goes through the TV's own player, which switches the screen into Dolby Vision; HDR10 and HLG play in TiviBro's built-in player unless you choose otherwise under **Settings > Playback and buffering > HDR and Dolby Vision**.  **Settings > Diagnostics > What this TV can play** lists what your TV handles.  See [Watching fullscreen](Watching-fullscreen).

<p align="center"><a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-caps.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-caps.png" width="60%" alt="What this TV can play"></a></p>


**Why is there no sound on some movies?**
LG TVs from 2020, 2021 and 2022 (the C1 and C2 among them) can't decode DTS.  TiviBro warns you in the movie details; pick another audio track under **Options** if the movie has one.

**What does each setting do?**
Every option, with its choices and default, is in the [Every setting](Settings-Playback-and-buffering) pages, one per section of Settings.

**A channel I watch keeps dying.  Can TiviBro use the HD copy instead?**
Yes, by itself.  When your playlist has the same channel more than once, TiviBro switches to another version once the player gives up.  See [Other versions of a channel](Other-versions-of-a-channel).

**Can I use more than one playlist?**
Yes.  **Settings > Playlists and guide > Add playlist…**.  Each playlist keeps its own groups, favorites, hidden items, names and guide setup.

**Does it work with Dispatcharr or other proxies?**
Yes.  Use the proxy's address as the server (Xtream) or playlist address (M3U).

**What is the "network helper", and why does TiviBro need it?**
It's a part of TiviBro that runs in the background on the TV and talks to your provider for the app: the channel list, the guide and the streams.  webOS won't let an app talk to most IPTV servers directly, so the helper does it on the TV itself, and sends a custom User-Agent when your provider asks for one.  Leave **Connection** on **Automatic**.  It only contacts your own provider (and the logo projects, if you turn them on); nothing else leaves your TV.  If Settings says it's *not running*, restart TiviBro.  More: [What is the network helper?](Troubleshooting#what-is-the-network-helper)

**My provider has a guide, but some channels say "No guide information".**
See [The programme guide](The-programme-guide).  Smart match in the web editor usually fixes most of them in one go.

**Can my backup be read by someone else?**
Not without your passphrase.  See [Backup and restore](Backup-and-restore) and [Privacy and security](Privacy-and-security).

**Why is there no multiview?**
webOS lets an app play only one video at a time, so a second channel always stops the first.  An earlier test build tried it and it didn't work on real TVs, so it was taken out.

**Something else?**
Try [Troubleshooting](Troubleshooting), or open an [issue](https://github.com/ohmybahgosh/TiviBro/issues) with a copy of **Settings > Diagnostics > View app log** (it hides usernames and passwords).
