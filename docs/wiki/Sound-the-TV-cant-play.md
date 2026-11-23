<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*On the TV*

LG TVs from 2020, 2021 and 2022 (webOS 5, 6 and 22, including the C1 and C2) can't play **DTS** sound at all.  No LG TV plays **Dolby TrueHD**, and **FLAC** with more than two channels doesn't play either.  Many movie files have one of those as their only sound, so they play with no sound.

TiviBro checks the sound before a movie, episode or My media file starts:

- **Another audio track the TV can play**, in the same language (or your **Audio language**): TiviBro plays that one.  Nothing to convert.
- **Only sound the TV can't play:** the network helper converts it to **Dolby Digital (AC-3)** while you watch, and TiviBro says so once ("Converting DTS audio for this TV").  The picture isn't touched, only the sound.  5.1 stays 5.1; 7.1 becomes 5.1.  It works with a soundbar or receiver too, since every one of them takes Dolby Digital.
- **Seeking** in a converted movie takes a moment longer than usual: the conversion starts again from the new spot.  The time, the progress bar, where you left off and subtitles all keep the movie's own time.
- **Audio track** in the quick menu lists the movie's own tracks.  Picking another one the TV can't play converts that one instead.

The conversion uses the **audio converter**, a small program (about 2 MB) that comes with TiviBro.  The network helper unpacks it onto the TV's storage the first time it runs, so there is nothing to download or answer.  (A copy of TiviBro built without it downloads it once from TiviBro's releases on GitHub instead: a movie that needs it asks first, and **Settings > Audio and subtitles** can get it or remove it.)  A converted movie plays in TiviBro's own player, as live channels do, with its picture untouched.  It is turned off or on with **Settings > Audio and subtitles > Convert audio the TV can't play**.

Live channels with sound the TV can't play are converted the same way, when the stream says what its sound is.

---

← [DASH channels and protected channels](DASH-channels-and-protected-channels)  ·  [Home](Home)  ·  [Audio sync: sound ahead of or behind the picture](Audio-sync-sound-ahead-of-or-behind-the-picture) →
