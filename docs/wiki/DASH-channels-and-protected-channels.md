<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*On the TV*

Some M3U playlists, the ones made for Kodi or TiviMate, have MPEG-DASH channels: an address ending in `.mpd`, or `#KODIPROP` lines saying `manifest_type=mpd`.  TiviBro plays them with its DASH player, which it loads the first time such a channel plays, and falls back to the TV player.

A DASH channel can also be protected, with its licence in `#KODIPROP:inputstream.adaptive.license_type` and `license_key` lines:

- **ClearKey** with the keys in the playlist (`license_key=` a key ID and key in hex, `kid:key`) plays on any TV that plays DASH.
- **Widevine** and **PlayReady** send TiviBro to the licence server in the playlist, with the headers it gives (User-Agent and Referer through the network helper).  Whether it plays depends on the TV: many LG TVs support Widevine in apps, some don't, and some providers only give licences to their own apps.

When a protected channel won't play, TiviBro says so ("This channel is protected (Widevine), and this TV could not play it") instead of trying again and again.

---

← [Multiview: two channels side by side](Multiview-two-channels-side-by-side)  ·  [Home](Home)  ·  [Sound the TV can't play](Sound-the-TV-cant-play) →
