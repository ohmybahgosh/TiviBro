<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Web editor: the web editor*

**Where it comes from.**  For Xtream providers:

- **Per channel** (recommended for most): the TV asks for each channel's next shows as you browse.  Fast and light.
- **Full XMLTV file**: the TV downloads your provider's whole guide.  Days ahead and manual matching, but files are often 20 to 200 MB.  Live progress (speed, percent, time left) shows in the editor and in the corner of the TV.
- **Off**: only your own sources.

M3U playlists can use the guide address inside the playlist.

**Extra sources.**  Add any `.xml` or `.xml.gz` guide.  Zipped guides work on every TV: the network helper unzips them as they download, and it also unzips provider guides that arrive gzipped.  **Recommended free guides** lists community guides by region (epgshare01, iptv-epg.org, i.mjh.nz for Pluto, Samsung TV Plus, Plex and Roku, and more), each with a one-click **Test**.  The first source in the list wins when two cover the same channel, and **Offset** fixes a guide that is an hour off.

**Public guide fill-in.**  Step 3 on the Guide page (the links at the top of the page jump to each step) (on by default).  After your sources and your provider's guide have loaded, the TV lists the channels that still have nothing and looks them up in two free, community-run guides: **epg.pw** (20 countries, lighter files, tried first) and **iptv-epg.org** (70 countries, bigger and more complete).  Channels match by guide id, a US local station's call sign or the name, and only in their own country's guide when TiviBro can tell the country.  Pluto TV channels (guide ids like "US_5ca5…") are also looked up in Pluto's own guide from i.mjh.nz, by id, when there are three or more of them with nothing.  What it finds never replaces a guide you already have.  The card shows how many channels were filled in from each, lets you turn it off, and lets you pick up to eight countries instead of **Automatic** (the countries of the channels that need a guide, up to four).  The TV fetches the files itself, at most twice a day, in the background once your own guide is on screen; iptv-epg.org needs the network helper (Settings > Playback > Network: Automatic).  Programmes from a public guide say "public guide" on the TV, and a wrong match is fixed like any other: Smart match or **Hold OK > Assign guide**.

**Watchlist.**  Its own page in the editor's menu: type a show, team or name and **Add**; **✕** removes one.  The TV looks for them in the guide and sets reminders (see [Watchlist](Watchlist)).

**Smart match** fixes channels showing "No guide information".  It ignores clutter, understands country codes, East and West feeds, numbered channels and US call signs, then shows its best guess with a confidence score.  You approve or decline each one, and nothing changes until you press **Apply**.

<p align="center">
  <a href="https://tivibro.app/view/#editor-guide"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-guide.png" width="100%" alt="The guide page"></a>
  <a href="https://tivibro.app/view/#editor-guide-progress"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-guide-progress.png" width="49%" alt="Guide download progress"></a>
  <a href="https://tivibro.app/view/#editor-smart-match"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-smart-match.png" width="49%" alt="Smart match"></a>
</p>

---

← [Channel names](Channel-names)  ·  [Home](Home)  ·  [Playlists](Playlists) →
