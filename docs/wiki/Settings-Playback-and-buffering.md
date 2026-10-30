<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Every setting*

Every option in **Settings**, section by section, with its choices and what it does.  The default is in **bold**.  Changes take effect straight away; nothing needs a restart.

On a row with a choice, **◀ ▶** change it (with the Magic Remote, click the **‹ ›** arrows).  **OK** opens a row that leads to a page (marked **›**) or runs an action.  **Back** goes up a page, then to the section list, then to the menu.


How channels start, how much video TiviBro holds, which player it uses, and what it does when a stream struggles.

<p align="center">
  <a href="https://tivibro.app/view/#tv-set-playback"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-playback.png" width="49%" alt="Playback and buffering, top"></a>
  <a href="https://tivibro.app/view/#tv-set-playback-2"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-playback-2.png" width="49%" alt="Playback and buffering, bottom"></a>
</p>

| Setting | Choices | What it does |
|---|---|---|
| **Buffer profile** | Fast zapping · **Balanced** · Smooth · Rock solid · Custom | How much video is held before a channel starts and while it plays.  More buffer rides out a shaky provider or Wi-Fi; less starts channels sooner.  The profiles: *Fast zapping* starts at 0.5 s and reads 10 s ahead; *Balanced* 2 s and 30 s; *Smooth* 4 s and 45 s; *Rock solid* 8 s and 60 s.  Bigger profiles also wait longer before treating a frozen picture as stuck, and retry more times.  Previews in the guide window always start quickly; the full profile applies in fullscreen. |
| **Profile details** | (information) | What the chosen profile does: how much it buffers before starting, how far it reads ahead, and the level it refills to after running dry. |
| **Start-up buffer** *(Custom only)* | 0.5 s to 15 s, **3 s** | Seconds of video buffered before a channel starts playing. |
| **Read-ahead** *(Custom only)* | 10 s to 120 s, **30 s** | How far ahead the player downloads while playing. |
| **Keep behind playhead** *(Custom only)* | 2 s to 30 s, **8 s** | Video kept behind what you are watching.  Lower saves TV memory on long sessions. |
| **Freeze detection** *(Custom only)* | 3 s to 20 s, **6 s** | How long a frozen picture is tolerated before the player recovers it. |
| **Reconnect attempts** *(Custom only)* | 3 to 50, **8** | Tries before the player gives up on a channel.  The count starts again after 30 seconds of clean playback. |
| **Player engine** | **Automatic** · Built-in demuxer · TV player | *Automatic* uses TiviBro's built-in player (fine buffer control, steady on sloppy streams) and moves to the TV's own player when a server blocks it or the stream needs it.  *TV player* uses the least CPU but ignores the buffer settings.  Every choice decodes in the TV's hardware. |
| **Stream format** *(Xtream playlists)* | **MPEG-TS** · HLS | MPEG-TS usually switches channels faster.  HLS copes better with a weak connection and some providers prefer it. |
| **Connection** | **Automatic (recommended)** · Direct | *Automatic* sends provider requests through the [network helper](Troubleshooting#what-is-the-network-helper), which webOS needs for most providers (it adds the headers the TV insists on, unzips guides, and works around sloppy servers).  *Direct* only works with servers that allow app requests. |
| **Network helper** | (information) | Whether the helper is running.  **Settings > Diagnostics** shows its port and its log. |
| **Buffer meter** | **When low** · Always · Off | A small gauge in fullscreen showing how many seconds of video are banked. |
| **Preview in channel list** | **On** · Off | Plays the channel you rest on in the Channels screen.  Turn it off on very slow TVs for the snappiest list. |
| **When a channel stops working** | **Switch to another version** · Ask me · Keep retrying | When a channel has run out of retries and your playlist has it more than once (another quality, another group, or a copy you hid), TiviBro switches to the next version, steadiest first: Full HD, HD, unmarked, 4K, then SD.  *Ask me* asks before switching.  See [Other versions of a channel](Other-versions-of-a-channel). |
| **Turn on last channel at launch** | **On** · Off | Starts the channel you watched last when TiviBro opens. |
| **HDR and Dolby Vision** | **Automatic** · TV player for all HDR · Built-in player | *Automatic* plays Dolby Vision through the TV player (which switches the screen into Dolby Vision itself) and keeps HDR10 and HLG on the built-in player for steadier buffering.  Pick *TV player for all HDR* if HDR pictures look grey or washed out. |
| **Picture** | **Normal** · Stretch · Zoom | Picture size for every channel.  A single channel can have its own size from the quick menu (**Picture**). |
| **Skip step** | 10 s · 15 s · **30 s** · 1 min · 2 min | How far **◀ ▶** jump while watching catch-up or a movie.  Pressing again quickly jumps further each time. |
| **Rewind / fast forward step** | 30 s · 1 min · **2 min** · 5 min · 10 min | How far **⏪ ⏩** jump while watching catch-up or a movie. |
| **◀ on a live channel with catch-up** | **Rewind** · Last channel | On a catch-up channel, **◀** rewinds into the current programme.  Without catch-up, **◀** always goes to the last channel. |
| **Info panel when switching channels** | **On** · Off | Off shows just the channel number and name when you change channel. |
| **Show stream details in the info panel** | **On** · Off | Adds the resolution, codecs and which player is in use. |
| **Black screen while switching** | On · **Off** | Hides the last picture until the next channel starts, instead of leaving it frozen. |
| **Audio language** | **The stream's own choice** · English · Spanish · French · German · and more | When a channel or movie has more than one audio track, plays this one.  Audio description tracks are skipped unless nothing else is in that language.  A track you pick from the quick menu wins until you change channel. |
| **Prefer surround sound** | On · **Off** | Picks the 5.1 or Dolby track in that language when there is one.  Your TV or soundbar needs to support it. |
| **Subtitles automatically** | **Off** · Any language · English only · Spanish only · … | Turns subtitles on when a stream has them; with a language, only subtitles in that language.  You can still switch them from the quick menu. |
| **Play next episode automatically** | **On** · Off | When an episode ends, the next one starts. |
| **Screens** *(Multiview)* | **Up to 2** · Up to 4 | How many channels multiview can show.  Many webOS TVs decode only two streams at once, and providers often limit connections. |

---

← [Parental controls](Parental-controls)  ·  [Home](Home)  ·  [Settings: Remote control](Settings-Remote-control) →
