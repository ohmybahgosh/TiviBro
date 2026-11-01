<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Every setting*

Your playlists, how often they reload, and where the programme guide comes from.  **OK** on a playlist opens its page.

<p align="center">
  <a href="https://tivibro.app/view/#tv-set-playlists"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-playlists.png" width="32%" alt="Playlists"></a>
  <a href="https://tivibro.app/view/#tv-set-playlist"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-playlist.png" width="32%" alt="A playlist's page"></a>
  <a href="https://tivibro.app/view/#tv-set-playlist-2"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-playlist-2.png" width="32%" alt="A playlist's guide settings"></a>
</p>

| Setting | Choices | What it does |
|---|---|---|
| *(each playlist)* | | Its name and type, and for the one in use, how many channels it has.  **OK** opens its page (below). |
| **Add playlist…** | | Opens the setup screen for another Xtream Codes or M3U playlist.  Each playlist keeps its own groups, favorites, hidden items, guide and name rules. |

On a playlist's page:

| Setting | Choices | What it does |
|---|---|---|
| **Use this playlist** | | Switches the TV to this playlist (shown when it isn't the one in use). |
| **Name** | | The name shown in Settings and the web editor. |
| **Connection** | | Server, username and password (or the M3U address).  Opens the setup screen, which tests the login before saving. |
| **User-Agent** | **Default** or your own | Only if your provider asks for a specific one (TiviMate's "User-Agent" setting).  The network helper sends it for this playlist. |
| **Reload channel list** | Every app start · Every 6 hours · **Every 12 hours** · Every day · Every 2 days · Every week · Only when I ask | How often the channel list is fetched again.  Your groups, renames and hidden items are always kept. |
| **Reload channels now** | | Fetches the channel list right away. |
| **Last reloaded**, **Subscription expires**, **Connections allowed** | (information) | From your provider, when it reports them. |
| **Provider guide** | Xtream: **Per channel** · Full XMLTV file · Off.  M3U: **From playlist** · Off | *Per channel* asks for each channel's programmes as you browse: light and fast.  *Full XMLTV file* downloads the provider's whole guide: days ahead, guide search and manual matching, but often 20 to 200 MB.  *Off* uses only your own guide sources. |
| **Provider guide time offset** | −12:00 to +12:00 in half hours, **0:00** | Use it when every programme from the provider guide is too early or too late. |
| **Guide sources ›** | | Extra XMLTV guides (`.xml` or `.xml.gz`), checked before the provider guide.  **OK** on one to edit its address, give it its own time offset, move it up or down (the first one wins when two cover a channel) or remove it.  **Add guide source…** adds one.  The [web editor](The-programme-guide) has a list of free guides by region. |
| **Reload guide** | Same choices as the channel list, **Every 12 hours** | How often the guide is downloaded again. |
| **Keep past days** | 1 · **2** · 3 · 5 · 7 days | How far back the guide keeps programmes, for catch-up browsing.  More days use more TV memory. |
| **Match guide by channel name** | **On** · Off | Links channels that have no guide id to a guide channel with the same name. |
| **Public guide fill-in ›** | **On** · Off | For channels with no guide from your sources or your provider: free guides from epg.pw and iptv-epg.org, matched by guide id, a local station's call sign or the name.  **Countries**: **Automatic** (the countries of the channels that need a guide) or up to eight you choose.  Shows how many channels each guide filled in and when it last looked; **Look again now** downloads them again.  TiviBro hosts nothing and sends no logins.  See [Public guide fill-in](The-programme-guide). |
| **Reload guide now** | | Downloads the guide right away. |
| **Guide last loaded**, each source, **Channels with guide data** | (information) | When the guide loaded, how many channels and programmes each source gave, and how many of your channels have a guide. |
| **Assign guide to channels without one** | | Lists channels with no guide; pick one and search the guide for the right channel.  Also on any channel: **Hold OK > Assign guide…**. |
| **Set-up tour** *(playlist in use)* | | Runs the [set-up tour](The-set-up-tour) again: countries, names, East or West, your city, event channels, clutter, logos and look.  Shows when you last applied it. |
| **Channel name editor ›** | | Cleans up channel names (below). |
| **Event channels ›** | | Reads pay-per-view and sports pass channels whose names carry the event and time (below). |
| **Delete this playlist** | | Removes the playlist with its groups, favorites, hidden items and cached data.  Shown when you have more than one. |

**Channel name editor.**  Rules that strip clutter from every name at once.  Your provider's names are never changed: switch a rule off and the original comes back.  Names you set by hand stay.

<p align="center"><a href="https://tivibro.app/view/#tv-set-names"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-names.png" width="60%" alt="Channel name editor"></a></p>

| Setting | Default | What it does |
|---|---|---|
| **Clean up channel names** | **On** | The master switch.  Off shows the original names. |
| **Hide channels with nothing on** | Off | Event channels the provider names "Off Air", "Offline" or "No Event Scheduled" between events stay out of the lists while they say so, and come back by themselves when an event is named on them.  Favorites keep theirs.  Works even with name clean-up off. |
| **Clean group names too** | **On** | Turns "USA \| Sports" into "Sports" in the group list. |
| **Enable recommended defaults** / **Turn all default rules off** | | Set every built-in rule at once.  Your own lists are kept. |
| **Country and region prefixes** | **On** | "USA \| ESPN" → "ESPN", "\|UK\| BBC One" → "BBC One", "CA: TSN 1" → "TSN 1", "UK◈ Sky Store" → "Sky Store".  About 250 country, region and language codes (CAR, ARG, CO, CA-FR, AFG, PK and so on), with any separator: \| : - • » ◈ ▶. |
| **Category and package prefixes** | **On** | "VIP \| AMC" → "AMC", "24/7 - Friends" → "Friends", "SPORTS: TNT" → "TNT", "DEP \| TUDN 01" → "TUDN 01".  Also Spanish ones (Deportes, Cine, Noticias, Infantil, Novelas) and package words like Gold or Max. |
| **Quality and format tags at the end** | **On** | "CNN FHD" → "CNN", "Nat Geo (1080p)" → "Nat Geo", "AMC \| RAW" → "AMC". |
| **Decorative symbols** | **On** | "Fox News ᴴᴰ" → "Fox News", "TNT ★" → "TNT", "⚽ EPL 1" → "EPL 1", "⫘⫘⫘ UK ⫘⫘⫘" → "UK", "Event 2026™: Final" → "Event 2026: Final", "EL NUEVE SD \*" → "EL NUEVE".  Emoji, sport symbols, circled letters, arrows and shapes. |
| **Time zone feeds** | Off | "HBO (East)" → "HBO", "Starz West" → "Starz".  Off by default because East and West feeds would end up with the same name. |
| **Any short bracketed tag at the ends** | Off | "[EN] Sky News" → "Sky News", "AMC (Backup)" → "AMC".  Off by default because it can remove useful text like "(Sports)". |
| **Free streaming service prefixes** | Off | "Pluto US \| CNN Headlines" → "CNN Headlines", "TUBI \| ION" → "ION", "Samsung TV Plus: Bob Ross" → "Bob Ross".  Pluto, Tubi, Plex, Samsung TV Plus, Roku, Xumo, Stirr, Distro, Local Now, LG Channels and more.  Off by default because a Pluto or Tubi copy then looks like the real channel. |
| **Country codes and names at the end** | Off | "CANAL 4 PAN" → "CANAL 4", "BEIN SPORTS 5 (USA)" → "BEIN SPORTS 5", "TN (Argentina)" → "TN".  Off by default because channels from different countries can end up with the same name. |
| **Status notes at the end** | Off | "FloHockey 39 - Off Air" → "FloHockey 39", "PPV 07 \| OFFLINE" → "PPV 07".  Off by default because the note tells you nothing is on; **Hide channels with nothing on** hides those channels instead. |
| **Your prefixes** / **Your suffixes** | empty | Your own text to remove from the start or end of names, any capitalisation.  Spaces count (shown as ·), so " HD" won't touch "WHD".  **Paste a comma separated list…** takes TiviMate's format, for example `US: , UK: , NOW \| `. |
| **Preview** | | Names from your channels before and after, the ones that change first. |

**Event channels.**  For pay-per-view, league passes and one-off games whose name carries the matchup, date and time (see [Event channels](Event-channels-pay-per-view-and-sports-passes)).

<p align="center"><a href="https://tivibro.app/view/#tv-set-events"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-events.png" width="60%" alt="Event channels"></a></p>

| Setting | Default | What it does |
|---|---|---|
| **Read events from channel names** | **On** | Shows the event from the name in the guide at its time, with "Starts 7:30 PM" before it and "Ended" after.  A real guide for the channel always wins. |
| **Short channel names** | **On** | "NCAAB 001 \| NORTH FLORIDA @ CHARLESTON SOUTHERN (M) \| 12.18 11:00 AM" shows as "NCAAB 001", with the game on the line under it. |
| **Events by time** | **On** | A group with every event channel that is on now or starts in the next two weeks, soonest first. |
| **Times with no time zone are in** | **The provider's time zone** | For names without ET, PT, UK and so on.  US Eastern, Central, Mountain or Pacific, UK, Central Europe, UTC, or this TV's time.  Times always show in the TV's own time. |
| *(list)* | | How many event channels the playlist has, and the next few events. |

---

← [Settings: Remote control](Settings-Remote-control)  ·  [Home](Home)  ·  [Settings: Groups, sorting, hidden](Settings-Groups-sorting-hidden) →
