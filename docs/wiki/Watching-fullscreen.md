<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*On the TV*

- **▲ ▼** or **CH + / CH −** change channel.  An info bar shows the channel, what's on now and next, and how far into the programme you are.
- **▶** shows the full programme info.  **Yellow** jumps back to the last channel.  **Green** lays the guide over the video.
- **Green** (or **OK > Channel list**) lays the channel list over the video.  **OK** on another channel switches to it and keeps the list open so you can keep browsing; **OK** on the channel that's already playing closes the list.  **◀ ▶** change group.
- **OK** opens the **quick menu**: Channel list, From start (catch-up channels), Favorite, TV guide, Picture size, Multiview, Sleep timer, Stream info and Reconnect.  Pick which buttons appear under **Settings > Remote control > Quick menu buttons**.
- **Red** or **Hold OK** opens options: audio track, subtitles, picture size for this channel, and more.

<p align="center"><a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/media/zap.mp4"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/media/zap.gif" width="100%" alt="Changing channels, info and the quick menu"></a></p>
<p align="center"><sub><a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/media/zap.mp4">Watch the MP4</a></sub></p>

<details>
<summary><b>Screenshots</b></summary>
<p align="center">
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-fullscreen.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-fullscreen.png" width="49%" alt="Fullscreen with the info bar"></a>
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-quick-menu.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-quick-menu.png" width="49%" alt="Quick menu"></a>
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-info.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-info.png" width="49%" alt="Programme info"></a>
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-mini-guide.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-mini-guide.png" width="49%" alt="Guide over the video"></a>
</p>
</details>

**Smooth playback.**  TiviBro picks a player per stream (MPEG-TS, the TV's own player, or HLS) and falls back automatically if one struggles.  It watches for frozen pictures and reconnects on its own, with a short wait that grows between tries.  On a channel that keeps running dry it holds a bigger cushion before playing again (shown as *Buffering NN%*), and lets it shrink back once the stream settles.  It also rides out providers that jump their timestamps, briefly refuse connections, or send corrupted data.  If a provider is slow or your Wi-Fi is weak, try **Settings > Playback and buffering > Buffer profile**, or switch the **Stream format** between MPEG-TS and HLS.

It tries hard never to just stop:

- **Wi-Fi drops:** it waits for the network ("No network.  Waiting for it to come back") without using up its retries, and reconnects the moment the TV is back online.
- **A channel keeps failing:** it tries the TV's own player and the provider's HLS version of the channel, then keeps retrying every 15 seconds for up to 20 minutes with a message on screen, so a channel that comes back after a provider hiccup recovers by itself.
- **A channel never starts:** after a couple of quick retries it says plainly whether the provider is refusing it or the TV can't decode it.  **OK** tries again.
- **Paused live TV:** a short pause carries on where you left off.  After a long pause TiviBro lets the connection go (the provider would drop it anyway) and **Play** brings you back to live.
- **Movies and catch-up** pick up from the same spot after a dropped connection, and when you leave TiviBro (Home button, another input) and come back.

**HDR, Dolby Vision and sound formats.**  TiviBro reads what each stream is before the picture starts: from the HLS playlist, from the MPEG-TS stream, or for movies from your provider's details.  The info panel shows it, for example *4K  HEVC  Dolby Vision 8  E-AC-3 5.1*, and movie details show it before you press play.

- **Dolby Vision** plays through the TV's own player, which switches the screen into Dolby Vision itself.
- **HDR10 and HLG** stay on TiviBro's built-in player by default, for its steadier buffering.  If HDR pictures look grey or washed out, set **Settings > Playback and buffering > HDR and Dolby Vision** to *TV player for all HDR*.
- **HEVC, AV1, AAC, Dolby Digital (AC-3) and Dolby Digital Plus (E-AC-3, Atmos)** play on webOS 6 and later TVs.  Anything the built-in player can't decode moves to the TV's player automatically.
- **DTS:** LG TVs from 2020, 2021 and 2022 (including the C1 and C2) can't play DTS sound.  TiviBro warns you when a movie only has DTS, so pick another audio track under **Options** if there is one.
- **Settings > Diagnostics > What this TV can play** lists every format and which player handles it on your TV.

---

← [Groups and the menu](Groups-and-the-menu)  ·  [Home](Home)  ·  [Catch-up](Catch-up) →
