<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logos/clean/tivibro-wordmark.png">
    <img alt="tiviBro" src="logos/clean/tivibro-wordmark-on-light.png" width="460">
  </picture>
</p>

<p align="center">
  <b>The IPTV player LG TVs never got.</b><br>
  A free, guide-first IPTV player for LG webOS, built to feel like TiviMate and go further.
</p>

<p align="center">
  <img alt="Platform: LG webOS" src="https://img.shields.io/badge/platform-LG%20webOS%204%2B%20%C2%B7%20built%20for%2025-5B8CFF?style=flat-square">
  <img alt="Version" src="https://img.shields.io/badge/version-0.6.0%20alpha-33E1FF?style=flat-square">
  <img alt="Price: free" src="https://img.shields.io/badge/price-free-3DDC97?style=flat-square">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-8F9BBF?style=flat-square">
  <img alt="No bundler" src="https://img.shields.io/badge/plain-HTML%20%2F%20JS-141A2E?style=flat-square">
</p>

<p align="center">
  <a href="https://tivibro.app"><b>tivibro.app</b></a> ·
  <a href="#what-no-other-iptv-player-does">What's different</a> ·
  <a href="#see-it-in-action">See it in action</a> ·
  <a href="#the-web-editor">Web editor</a> ·
  <a href="#gallery">Gallery</a> ·
  <a href="#install">Install</a> ·
  <a href="docs/USER-GUIDE.md"><b>User guide</b></a> ·
  <a href="../../wiki">Wiki</a> ·
  <a href="#develop">Develop</a>
</p>

> [!WARNING]
> **TiviBro is under active development.**  These are early test builds: expect bugs and rough edges, and settings or features may change between versions.  Keep a backup before updating (**Backup and restore** in the [web editor](#the-web-editor)).  Found a bug?  On the TV, **Settings > Diagnostics > Report a problem** (also on the first screen) fills in a [GitHub issue](https://github.com/ohmybahgosh/TiviBro/issues) for you from your phone: see [Report a problem](#report-a-problem).

<p align="center"><a href="docs/media/guide.mp4"><img src="docs/media/guide.gif" width="100%" alt="The TiviBro guide, preview and fullscreen"></a></p>
<p align="center"><sub>The guide is home: browse, preview in the window, OK again for fullscreen.  <a href="docs/media/guide.mp4">Watch the full-quality MP4</a>.  Every picture here is clickable.</sub></p>

TiviBro plays your own IPTV subscription (Xtream Codes or M3U with XMLTV) on LG webOS TVs.  The guide is the home screen, the Magic Remote works everywhere, and a companion web editor lets you clean up hundreds of groups from your phone or computer instead of with a TV remote.

### 📱 Set it up from your phone

No typing logins with a remote.  The first screen shows a QR code: scan it with your phone's camera and TiviBro's editor opens there, already signed in.  Paste your login (or restore a backup), and the TV loads your channels on its own and walks you through tidying them up.  Afterwards the same editor, on your phone or computer, renames, hides, sorts and cleans up thousands of channels.

<p align="center">
  <a href="https://tivibro.app/view/#tv-first-run"><img src="docs/screenshots/tv-first-run.png" width="58%" alt="The first screen with its QR code"></a>
  <a href="https://tivibro.app/view/#editor-phone-welcome"><img src="docs/screenshots/editor-phone-welcome.png" width="19%" alt="The editor on a phone, right after scanning"></a>
  <a href="https://tivibro.app/view/#editor-phone-add"><img src="docs/screenshots/editor-phone-add.png" width="19%" alt="Typing the login on the phone"></a>
</p>

> **TiviBro does not provide any channels, streams or playlists.**  You bring your own legal subscription.

> **Status: beta.**  Everything here runs in the webOS 25 Simulator and in desktop test harnesses.  Real-TV testing is under way, so expect rough edges.

## Why TiviBro

| | |
|---|---|
| 📱 **Set up from your phone** | Scan the QR code on the first screen and type your login on your phone, not with the remote.  The TV takes it from there. |
| 📺 **Guide first** | Live preview top left, details top right, groups one press away.  OK previews, OK again goes fullscreen, just like TiviMate. |
| ⏪ **Catch-up done right** | Rewind the guide into the past and replay what you missed, or restart the show you just tuned into. |
| 🎬 **Movies and shows** | Your provider's VOD with posters, seasons, episodes, My list and resume. |
| 🧩 **Multiview** | Two channels side by side (four on TVs that can take it). |
| 🧭 **Set up in two minutes** | A new playlist starts a tour that shows what it has (countries, East and West copies, local cities, event channels, duplicates) and tidies it with the remote, or with your phone by scanning a code. |
| 🖼️ **Logos for every channel** | Missing logos filled in from two open logo projects, matched by guide id, name, country and call sign.  Or one matching style for the whole list. |
| 🖥️ **A real editor** | Hide, sort, rename, copy and match guides for hundreds of channels from any browser.  Drafts, undo and restore points. |
| 🔒 **Locked backups** | Everything in one AES-256-GCM file.  Restore onto a brand-new TV straight from the first screen. |
| 🔁 **Backup versions** | Playlists often carry a channel in FHD, HD and SD.  TiviBro tags each copy, lets you switch between them, and if one dies it moves to the next by itself and tells you, even to copies you hid to tidy your lists. |
| 🏟️ **Event channels** | Pay-per-view and sports passes that cram the whole listing into the channel name ("NCAAB 001 \| NORTH FLORIDA @ CHARLESTON SOUTHERN (M) \| 12.18 11:00 AM") show as **NCAAB 001**, with the game in the guide at its real time, in your time zone.  **Events by time** lists what's on next across all of them. |
| 🧹 **Clean names, tidy lists** | Strips "USA \|", "FHD", "⚽", "ᴴᴰ" and hundreds of other tags.  Hides divider groups and keeps channels that say "Off Air" or "No Event Scheduled" out of the way until something is on. |
| ⏰ **Reminders, a watchlist and parental controls** | A reminder on any future programme, a watchlist that finds your teams and shows in the guide and reminds you, and a PIN for channels, groups or Settings. |
| 🛟 **Streams that don't quit** | Reconnects with backoff, waits out Wi-Fi drops, tries every player before giving up, and keeps a dropped channel coming back by itself.  Movies and catch-up resume where they dropped. |
| 🌈 **HDR, Dolby Vision and Atmos** | Reads each stream's format before the picture starts and sends Dolby Vision to the TV's own player, HDR10 and HLG to the steadier built-in one.  The info panel shows *4K  HEVC  Dolby Vision  E-AC-3 5.1 Atmos*. |
| 🎨 **Midnight Electric** | A dark, calm look with nine backgrounds (true black for OLED, high contrast), twelve accents or your own, and an outline focus style for across the room. |
| 💸 **Free and open** | MIT licensed, no accounts, no ads, no tracking. |

## What no other IPTV player does

TiviMate set the bar for IPTV on a TV, and TiviBro follows its layout on purpose.  These are the things we haven't found in TiviMate or any other IPTV player, on any platform:

| | |
|---|---|
| 📱 **Set up from your phone, from the very first screen** | A QR code waits beside the login form.  Scan it and TiviBro's editor opens on your phone, signed in: type your login with a real keyboard or restore a backup, and the TV moves on by itself.  No other IPTV app on a TV starts this way. |
| 🧭 **A set-up tour built from your own playlist** | Right after you connect, TiviBro counts what your list has and asks only about that: the countries in it, East or West, the cities its local groups carry, its event channels, its duplicates.  A running count shows what you'll keep, and the same QR code lets you do it on your phone instead. |
| 🖼️ **Fills in missing logos, without hosting a single one** | A small index points at iptv-org's and tv-logos' own logos.  Matched by guide id, cleaned name and country, and local call sign; a broken provider logo is swapped too.  Pick each channel's own logo or one matching style for dark screens. |
| 🏟️ **Reads sports and PPV listings from channel names** | When a provider writes the event into the name instead of the guide, TiviBro turns it into a short channel name, a guide entry at the real time in your time zone, and an **Events by time** list across all your passes.  Dozens of naming styles, tested on 1,250 real event channels. |
| 🖥️ **A full editor on your computer** | Clean up 10,000 channels with a keyboard and mouse instead of a remote: hide, sort, rename, copy and move, then **Send to TV**.  Unsent work is autosaved on the TV within seconds, with a version history, so a refresh never costs you an hour. |
| 🔁 **Switches to a working copy by itself** | Same channel in FHD, HD and SD?  When one dies, TiviBro moves to the next version on its own and tells you. |
| 🧹 **Clean-up that already knows IPTV** | Pick your city once and every local group (ABC, CBS, NBC, FOX, CW, PBS…) keeps only your stations.  Keep East or West feeds in one click.  Name rules preloaded for about 250 country codes, quality tags, symbols and emoji (no typing prefix lists by hand), countries read from any naming style, duplicates in different qualities, and **Smart match** for channels without a guide. |
| 🙈 **Hides channels with nothing on** | Event channels that say "Off Air" or "No Event Scheduled" stay out of the way, and come back by themselves when an event is named. |
| 🔐 **Locked backups, restored from the first screen** | One AES-256 file with every playlist, login, group and setting.  A brand-new TV restores it from a computer before you've touched a setting. |
| 🐞 **Report a problem from the couch** | **Report a problem** shows a QR code.  Your phone opens a short form, the TV adds its version, model and log with logins and server names taken out, and GitHub's bug form opens filled in.  No copying logs off the TV. |
| 💸 **Everything free, nothing locked** | Catch-up, multiview, multiple playlists, backups, reminders and parental controls are all included.  Open source, no account, no ads, no tracking. |
| 📺 **Made for LG TVs** | Runs on the TV itself, webOS 4 and newer.  No Android box or Fire Stick needed. |

| | TiviBro | TiviMate |
|---|---|---|
| Runs on LG webOS TVs | ✅ | ❌ Android TV and Fire TV |
| Price | Free, every feature | Free version, Premium paid |
| Catch-up, multiview, multiple playlists, backups | ✅ Free | Premium |
| Open source | ✅ MIT | ❌ |
| Sports and PPV events read from channel names | ✅ | ❌ |
| Edit your playlist from a computer, with autosaved drafts | ✅ | ❌ On the TV only |
| Switches to another version of a dead channel by itself | ✅ | ❌ |
| Preloaded name clean-up rules | ✅ About 250 country codes, tags, symbols | Your own prefix and suffix lists |
| Hide channels with nothing on | ✅ | ❌ |
| Pick your city for every local channel group at once | ✅ | ❌ One group at a time |
| Keep East or West feeds in one step | ✅ | ❌ |
| Guided set-up built from your playlist | ✅ Countries, feeds, city, events, logos, look | ❌ |
| Set up by scanning a QR code with your phone | ✅ From the first screen | ❌ Type it with the remote |
| Fills in missing channel logos | ✅ Two open logo libraries, two styles | ❌ |
| Recording | Not yet | ✅ Premium |

<sub>TiviMate column from its own site and public guides, October 2026.  TiviMate is a great app; this is what TiviBro adds.</sub>

## See it in action

<sub>All recordings use a made-up demo provider.  The pill in the top right shows which remote button was pressed.</sub>

<table>
<tr>
<td width="58%"><a href="docs/media/zap.mp4"><img src="docs/media/zap.gif" width="100%" alt="Changing channels and the quick menu"></a><br><sub><a href="docs/media/zap.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### Zap like cable TV

**▲ ▼** or **CH +/−** to change channel, **▶** for programme info, **Yellow** for the last channel, **Green** for the guide over the video.

**OK** opens the quick menu: channel list, start over, favorite, picture size, multiview, sleep timer, stream info, reconnect.  You choose which buttons it shows.

</td>
</tr>
</table>
<table>
<tr>
<td width="42%" valign="top">

### Catch-up

Press **⏪** in the guide to travel back in time.  Programmes marked **↺** replay from the start with one press.

**Hold OK** on any programme for more: watch fullscreen, earlier programmes by day, reminders, channel options.

</td>
<td width="58%"><a href="docs/media/catchup.mp4"><img src="docs/media/catchup.gif" width="100%" alt="Replaying a programme with catch-up"></a><br><sub><a href="docs/media/catchup.mp4">▶ MP4</a></sub></td>
</tr>
</table>
<table>
<tr>
<td width="58%"><a href="docs/media/groups.mp4"><img src="docs/media/groups.gif" width="100%" alt="Groups and the menu"></a><br><sub><a href="docs/media/groups.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### Groups beside the guide

Favorites and your own groups come first, then your provider's.  Moving through the list updates the guide behind it.

**◀** once more opens the menu: Guide, Channels, Movies, Shows, Search, Edit on phone, Settings.

</td>
</tr>
</table>
<table>
<tr>
<td width="42%" valign="top">

### Movies and shows

Categories, posters, ratings and plots.  Shows open into seasons and episodes, and TiviBro remembers where you stopped.

</td>
<td width="58%"><a href="docs/media/vod.mp4"><img src="docs/media/vod.gif" width="100%" alt="Movies and shows"></a><br><sub><a href="docs/media/vod.mp4">▶ MP4</a></sub></td>
</tr>
</table>
<table>
<tr>
<td width="58%"><a href="docs/media/search.mp4"><img src="docs/media/search.gif" width="100%" alt="Search"></a><br><sub><a href="docs/media/search.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### Search everything

Channels and programmes now, later and on catch-up, as you type, with filters for On now, Coming up and Replays.  OK watches, replays or sets a reminder.  Yellow adds the search to your watchlist.

</td>
</tr>
</table>
<table>
<tr>
<td width="42%" valign="top">

### Multiview

**Blue** puts a second channel beside the first.  The focused screen has the sound; **OK** takes it fullscreen.

</td>
<td width="58%"><a href="docs/media/multiview.mp4"><img src="docs/media/multiview.gif" width="100%" alt="Multiview"></a><br><sub><a href="docs/media/multiview.mp4">▶ MP4</a></sub></td>
</tr>
</table>
<table>
<tr>
<td width="58%"><a href="docs/media/settings.mp4"><img src="docs/media/settings.gif" width="100%" alt="Settings and appearance"></a><br><sub><a href="docs/media/settings.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### Make it yours

Twelve accent colours or your own from a hue and brightness, nine backgrounds (Midnight, Black OLED, Slate, Ocean, Forest, Plum, Mocha, High contrast, Classic), a white focus outline for distance viewing, text size, panel transparency, clock, logos and more, all live.

Plus remote remapping, parental controls, reminders, buffering profiles and on-TV diagnostics.

</td>
</tr>
</table>

<table>
<tr>
<td width="42%" valign="top">

### Never stuck on a dead channel

Same channel in FHD, HD and SD?  **Other versions** switches between them, and when one stops working TiviBro moves to the next version by itself and tells you.  Hiding the extra copies to tidy your lists (the set-up tour does it for you) keeps them as backups: hidden isn't gone.

</td>
<td width="58%"><a href="docs/media/versions.mp4"><img src="docs/media/versions.gif" width="100%" alt="Other versions of a channel"></a><br><sub><a href="docs/media/versions.mp4">▶ MP4</a></sub></td>
</tr>
</table>
<table>
<tr>
<td width="58%"><a href="docs/media/channels.mp4"><img src="docs/media/channels.gif" width="100%" alt="The Channels screen and channel options"></a><br><sub><a href="docs/media/channels.mp4">▶ MP4</a></sub></td>
<td width="42%" valign="top">

### The classic channel list

TiviMate's Channels layout: groups, channels with what's on, and a live preview.  **Hold OK** on any channel to favorite it, copy it into your own group, rename it, assign a guide, block or hide it.

</td>
</tr>
</table>
<table>
<tr>
<td width="42%" valign="top">

### Reminders

**OK** on a programme later tonight.  When it starts, TiviBro asks whether to switch, or switches by itself.

The **watchlist** does it for you: add "Yankees" or "Bluey" once, and TiviBro sets a reminder whenever one is coming up in the guide.

</td>
<td width="58%"><a href="docs/media/reminders.mp4"><img src="docs/media/reminders.gif" width="100%" alt="Reminders"></a><br><sub><a href="docs/media/reminders.mp4">▶ MP4</a></sub></td>
</tr>
</table>

<table>
<tr>
<td width="58%"><a href="https://tivibro.app/view/#tv-events-guide"><img src="docs/screenshots/tv-events-guide.png" width="100%" alt="Event channels in the guide"></a></td>
<td width="42%" valign="top">

### Pay-per-view and sports passes, readable

Providers often write the whole event into the channel name and leave the guide empty.  TiviBro reads it: a short channel name (**PPV 03**, **NCAAB 001**), **Starts 7:30 PM: Kings vs Pelicans** in the guide until it begins, then the matchup at its real time, converted to your time zone.  **Events by time** puts every upcoming game and fight in one list, soonest first.

</td>
</tr>
</table>

<table>
<tr>
<td width="58%"><a href="https://tivibro.app/view/#tv-tour-welcome"><img src="docs/screenshots/tv-tour-welcome.png" width="100%" alt="The set-up tour"></a></td>
<td width="42%" valign="top">

### A set-up tour from your own playlist

Connect, and TiviBro shows what your list holds, then walks you through it: the countries to keep, clean names, East or West, your city's local stations, sports and pay-per-view, the clutter, logos and colours.  It only asks about what your playlist has, keeps a running count, and changes nothing until **Apply**.  Or scan the code and finish on your phone.  [More](docs/USER-GUIDE.md#the-set-up-tour)

</td>
</tr>
</table>

<table>
<tr>
<td width="58%"><a href="https://tivibro.app/view/#tv-tour-logos"><img src="docs/screenshots/tv-tour-logos.png" width="100%" alt="Channel logos from the logo library"></a></td>
<td width="42%" valign="top">

### Logos for channels that have none

The logo library matches your channels to [iptv-org](https://github.com/iptv-org/database) and [tv-logos](https://github.com/tv-logo/tv-logos) by guide id, name and country, and call sign for local stations.  Fill in only what's missing, or use one matching style for every channel.  TiviBro hosts no images: each logo loads from its project.  [More](docs/USER-GUIDE.md#channel-logos)

</td>
</tr>
</table>

## The web editor

Open **Edit on phone** in the TV's side menu (or hold OK on any group).  It turns the editor on and shows a QR code to scan with your phone, plus an address and a password; open it in any browser on your network, on a computer or a phone.  Changes are drafts until you press **Send to TV**, and the TV picks them up in seconds.

<p align="center"><a href="docs/media/live-edit.mp4"><img src="docs/media/live-edit.gif" width="100%" alt="Hiding groups in the editor while the TV follows"></a></p>
<p align="center"><sub>Switching off the UK, FR and DE groups on the computer, then sending: the TV's group list updates by itself.  <a href="docs/media/live-edit.mp4">MP4</a></sub></p>

- **Drafts, undo and restore points.**  Nothing reaches the TV until you press **Send to TV**.  Every change can be undone, and the TV keeps restore points.
- **Never lose an hour of clean-up.**  Unsent work is autosaved in the browser and on the TV within seconds, with a draft history of versions.  A refresh, a closed tab or another computer picks up right where you left off.
- **Copy or move channels into any group,** including your provider's groups.  Each group can have its own sort order.
- **Smart clean-up.**  Keep only the countries you watch (read from codes, country words, channel prefixes or the provider's divider groups), pick your city for the local stations in every local group at once, keep East or West feeds, hide duplicate channels in different qualities, hide by keyword, empty groups and divider groups, and keep "Off Air" event channels out of the way.
- **Channel name rules** for about 250 country codes, quality tags, symbols and emoji, plus optional ones for streaming-service prefixes, country codes at the end and status notes.
- **Smart match** finds the right guide channel for channels showing "No guide information".  You approve or decline each guess.
- **Live guide download progress** on big XMLTV files: speed, percent and time left, on the computer and on the TV.
- **Recommended free guide sources** by region, each with a one-click **Test**.
- **Public guide fill-in.**  Channels your provider sends no guide for get one from the free epg.pw and iptv-epg.org guides, matched by guide id, local call sign or name.  On by default, never over a guide you already have, and the TV downloads the files itself.
- **Works on your phone.**  Scan the QR code in the TV's set-up tour, or open the address in any phone browser: a top bar for the pages, one pane at a time, and touch-sized controls.
- **Logins never leave the TV.**  The editor only ever sees server names.

<p align="center">
  <a href="https://tivibro.app/view/#editor-overview"><img src="docs/screenshots/editor-overview.png" width="49%" alt="Editor overview"></a>
  <a href="https://tivibro.app/view/#editor-copy-move"><img src="docs/screenshots/editor-copy-move.png" width="49%" alt="Copy or move channels"></a>
  <a href="https://tivibro.app/view/#editor-smart-match"><img src="docs/screenshots/editor-smart-match.png" width="49%" alt="Smart match"></a>
  <a href="https://tivibro.app/view/#editor-smart-cleanup"><img src="docs/screenshots/editor-smart-cleanup.png" width="49%" alt="Smart clean-up"></a>
</p>

### New TV?  Restore everything in a minute

A backup holds every playlist with its login, your groups, favorites, names, guide matches and settings, locked with your passphrase (AES-256-GCM) before it leaves the TV.  On a brand-new install, choose **Set up or restore from a computer** on the very first screen:

<p align="center"><a href="docs/media/restore.mp4"><img src="docs/media/restore.gif" width="100%" alt="Restoring a locked backup onto a brand-new TV"></a></p>
<p align="center"><sub>Fresh install, password from the TV, drop the file, unlock, restore.  TiviBro restarts with everything back.  <a href="docs/media/restore.mp4">MP4</a></sub></p>

## Gallery

<sub>Click any screenshot to open it full size.</sub>

<details open>
<summary><b>The set-up tour</b></summary>
<p align="center">
  <a href="https://tivibro.app/view/#tv-tour-welcome"><img src="docs/screenshots/tv-tour-welcome.png" width="32%" alt="What your playlist has"></a>
  <a href="https://tivibro.app/view/#tv-tour-countries"><img src="docs/screenshots/tv-tour-countries.png" width="32%" alt="Countries"></a>
  <a href="https://tivibro.app/view/#tv-tour-names"><img src="docs/screenshots/tv-tour-names.png" width="32%" alt="Channel names"></a>
  <a href="https://tivibro.app/view/#tv-tour-feeds"><img src="docs/screenshots/tv-tour-feeds.png" width="32%" alt="East or West"></a>
  <a href="https://tivibro.app/view/#tv-tour-locals"><img src="docs/screenshots/tv-tour-locals.png" width="32%" alt="Your local channels"></a>
  <a href="https://tivibro.app/view/#tv-tour-events"><img src="docs/screenshots/tv-tour-events.png" width="32%" alt="Sports and pay-per-view"></a>
  <a href="https://tivibro.app/view/#tv-tour-clutter"><img src="docs/screenshots/tv-tour-clutter.png" width="32%" alt="Clear the clutter"></a>
  <a href="https://tivibro.app/view/#tv-tour-logos"><img src="docs/screenshots/tv-tour-logos.png" width="32%" alt="Channel logos"></a>
  <a href="https://tivibro.app/view/#tv-tour-look"><img src="docs/screenshots/tv-tour-look.png" width="32%" alt="Make it yours"></a>
  <a href="https://tivibro.app/view/#tv-tour-done"><img src="docs/screenshots/tv-tour-done.png" width="32%" alt="All set"></a>
  <a href="https://tivibro.app/view/#tv-tour-phone"><img src="docs/screenshots/tv-tour-phone.png" width="32%" alt="Scan to set up on your phone"></a>
</p>
</details>

<details>
<summary><b>Guide and live TV</b></summary>
<p align="center">
  <a href="https://tivibro.app/view/#tv-guide"><img src="docs/screenshots/tv-guide.png" width="32%" alt="Guide"></a>
  <a href="https://tivibro.app/view/#tv-guide-preview"><img src="docs/screenshots/tv-guide-preview.png" width="32%" alt="Preview in the window"></a>
  <a href="https://tivibro.app/view/#tv-groups"><img src="docs/screenshots/tv-groups.png" width="32%" alt="Groups beside the guide"></a>
  <a href="https://tivibro.app/view/#tv-fullscreen"><img src="docs/screenshots/tv-fullscreen.png" width="32%" alt="Fullscreen with the info bar"></a>
  <a href="https://tivibro.app/view/#tv-quick-menu"><img src="docs/screenshots/tv-quick-menu.png" width="32%" alt="Quick menu"></a>
  <a href="https://tivibro.app/view/#tv-mini-guide"><img src="docs/screenshots/tv-mini-guide.png" width="32%" alt="Guide over the video"></a>
  <a href="https://tivibro.app/view/#tv-channels"><img src="docs/screenshots/tv-channels.png" width="32%" alt="The Channels screen"></a>
  <a href="https://tivibro.app/view/#tv-channel-options"><img src="docs/screenshots/tv-channel-options.png" width="32%" alt="Channel options"></a>
  <a href="https://tivibro.app/view/#tv-info"><img src="docs/screenshots/tv-info.png" width="32%" alt="Programme info"></a>
  <a href="https://tivibro.app/view/#tv-options"><img src="docs/screenshots/tv-options.png" width="32%" alt="Options"></a>
  <a href="https://tivibro.app/view/#tv-stream-info"><img src="docs/screenshots/tv-stream-info.png" width="32%" alt="Stream info"></a>
  <a href="https://tivibro.app/view/#tv-sleep"><img src="docs/screenshots/tv-sleep.png" width="32%" alt="Sleep timer"></a>
</p>
</details>

<details>
<summary><b>Event channels, other versions, reminders and parental controls</b></summary>
<p align="center">
  <a href="https://tivibro.app/view/#tv-events-guide"><img src="docs/screenshots/tv-events-guide.png" width="32%" alt="Event channels in the guide"></a>
  <a href="https://tivibro.app/view/#tv-events-list"><img src="docs/screenshots/tv-events-list.png" width="32%" alt="Events by time"></a>
  <a href="https://tivibro.app/view/#tv-set-events"><img src="docs/screenshots/tv-set-events.png" width="32%" alt="Event channels settings"></a>
  <a href="https://tivibro.app/view/#tv-versions"><img src="docs/screenshots/tv-versions.png" width="32%" alt="Other versions of a channel"></a>
  <a href="https://tivibro.app/view/#tv-quick-versions"><img src="docs/screenshots/tv-quick-versions.png" width="32%" alt="Other versions in the quick menu"></a>
  <a href="https://tivibro.app/view/#tv-failover"><img src="docs/screenshots/tv-failover.png" width="32%" alt="Switched to another version by itself"></a>
  <a href="https://tivibro.app/view/#tv-reminder-set"><img src="docs/screenshots/tv-reminder-set.png" width="32%" alt="A reminder set"></a>
  <a href="https://tivibro.app/view/#tv-reminder"><img src="docs/screenshots/tv-reminder.png" width="32%" alt="The reminder when it starts"></a>
  <a href="https://tivibro.app/view/#tv-pin"><img src="docs/screenshots/tv-pin.png" width="32%" alt="A blocked channel asks for the PIN"></a>
</p>
</details>

<details>
<summary><b>Catch-up, search and multiview</b></summary>
<p align="center">
  <a href="https://tivibro.app/view/#tv-catchup-guide"><img src="docs/screenshots/tv-catchup-guide.png" width="32%" alt="Past programmes in the guide"></a>
  <a href="https://tivibro.app/view/#tv-hold-menu"><img src="docs/screenshots/tv-hold-menu.png" width="32%" alt="Programme options"></a>
  <a href="https://tivibro.app/view/#tv-catchup-play"><img src="docs/screenshots/tv-catchup-play.png" width="32%" alt="Catch-up playing"></a>
  <a href="https://tivibro.app/view/#tv-search"><img src="docs/screenshots/tv-search.png" width="32%" alt="Search"></a>
  <a href="https://tivibro.app/view/#tv-multiview"><img src="docs/screenshots/tv-multiview.png" width="32%" alt="Multiview"></a>
  <a href="https://tivibro.app/view/#tv-menu"><img src="docs/screenshots/tv-menu.png" width="32%" alt="Menu"></a>
</p>
</details>

<details>
<summary><b>Movies, shows and settings</b></summary>
<p align="center">
  <a href="https://tivibro.app/view/#tv-movies"><img src="docs/screenshots/tv-movies.png" width="32%" alt="Movies"></a>
  <a href="https://tivibro.app/view/#tv-episodes"><img src="docs/screenshots/tv-episodes.png" width="32%" alt="Episodes"></a>
  <a href="https://tivibro.app/view/#tv-settings"><img src="docs/screenshots/tv-settings.png" width="32%" alt="Settings"></a>
  <a href="https://tivibro.app/view/#tv-settings-look"><img src="docs/screenshots/tv-settings-look.png" width="32%" alt="Appearance"></a>
  <a href="https://tivibro.app/view/#tv-first-run"><img src="docs/screenshots/tv-first-run.png" width="32%" alt="First start"></a>
  <a href="https://tivibro.app/view/#tv-first-run-remote"><img src="docs/screenshots/tv-first-run-remote.png" width="32%" alt="Set up from a computer"></a>
</p>
</details>

<details>
<summary><b>Every Settings section</b></summary>
<p align="center">
  <a href="https://tivibro.app/view/#tv-set-playback"><img src="docs/screenshots/tv-set-playback.png" width="32%" alt="Playback and buffering"></a>
  <a href="https://tivibro.app/view/#tv-set-remote-player"><img src="docs/screenshots/tv-set-remote-player.png" width="32%" alt="Buttons in the player"></a>
  <a href="https://tivibro.app/view/#tv-set-playlist"><img src="docs/screenshots/tv-set-playlist.png" width="32%" alt="A playlist"></a>
  <a href="https://tivibro.app/view/#tv-set-names"><img src="docs/screenshots/tv-set-names.png" width="32%" alt="Channel name editor"></a>
  <a href="https://tivibro.app/view/#tv-set-groups"><img src="docs/screenshots/tv-set-groups.png" width="32%" alt="Groups, sorting, hidden"></a>
  <a href="https://tivibro.app/view/#tv-set-guide"><img src="docs/screenshots/tv-set-guide.png" width="32%" alt="Guide, start screen, reminders"></a>
  <a href="https://tivibro.app/view/#tv-set-look"><img src="docs/screenshots/tv-set-look.png" width="32%" alt="Appearance"></a>
  <a href="https://tivibro.app/view/#tv-settings-parental"><img src="docs/screenshots/tv-settings-parental.png" width="32%" alt="Parental controls"></a>
  <a href="https://tivibro.app/view/#tv-set-editor-on"><img src="docs/screenshots/tv-set-editor-on.png" width="32%" alt="Edit on a phone or computer"></a>
  <a href="https://tivibro.app/view/#tv-set-updates"><img src="docs/screenshots/tv-set-updates.png" width="32%" alt="Updates and about"></a>
  <a href="https://tivibro.app/view/#tv-set-diag-test"><img src="docs/screenshots/tv-set-diag-test.png" width="32%" alt="Connection test"></a>
  <a href="https://tivibro.app/view/#tv-set-caps"><img src="docs/screenshots/tv-set-caps.png" width="32%" alt="What this TV can play"></a>
</p>
</details>

<details>
<summary><b>Web editor</b></summary>
<p align="center">
  <a href="https://tivibro.app/view/#editor-overview"><img src="docs/screenshots/editor-overview.png" width="49%" alt="Overview"></a>
  <a href="https://tivibro.app/view/#editor-copy-move"><img src="docs/screenshots/editor-copy-move.png" width="49%" alt="Copy or move"></a>
  <a href="https://tivibro.app/view/#editor-guide-progress"><img src="docs/screenshots/editor-guide-progress.png" width="49%" alt="Guide download progress"></a>
  <a href="https://tivibro.app/view/#editor-smart-match"><img src="docs/screenshots/editor-smart-match.png" width="49%" alt="Smart match"></a>
  <a href="https://tivibro.app/view/#editor-smart-cleanup"><img src="docs/screenshots/editor-smart-cleanup.png" width="49%" alt="Smart clean-up"></a>
  <a href="https://tivibro.app/view/#editor-feeds-local"><img src="docs/screenshots/editor-feeds-local.png" width="49%" alt="East and West feeds, and local channels by city"></a>
  <a href="https://tivibro.app/view/#editor-backup"><img src="docs/screenshots/editor-backup.png" width="49%" alt="Backup and restore"></a>
  <a href="https://tivibro.app/view/#editor-groups"><img src="docs/screenshots/editor-groups.png" width="49%" alt="Groups and channels"></a>
  <a href="https://tivibro.app/view/#editor-names"><img src="docs/screenshots/editor-names.png" width="49%" alt="Channel names"></a>
  <a href="https://tivibro.app/view/#editor-guide"><img src="docs/screenshots/editor-guide.png" width="49%" alt="The guide"></a>
  <a href="https://tivibro.app/view/#editor-playlists"><img src="docs/screenshots/editor-playlists.png" width="49%" alt="Playlists"></a>
  <a href="https://tivibro.app/view/#editor-history"><img src="docs/screenshots/editor-history.png" width="49%" alt="Changes and restore points"></a>
  <a href="https://tivibro.app/view/#editor-help"><img src="docs/screenshots/editor-help.png" width="49%" alt="Help"></a>
</p>
</details>

## Help

The **[user guide](docs/USER-GUIDE.md)** (also on the [wiki](../../wiki)) covers everything: every remote button, the guide, catch-up, movies and shows, multiview, other versions of a channel, event channels, reminders, parental controls, each page of the web editor, backups, and troubleshooting.  **[Every setting](docs/USER-GUIDE.md#every-setting)** explains each option in Settings, with its choices and default.

### Report a problem

Something broke?  Report it from the TV, no cables or log copying:

1. On the TV: **Settings > Diagnostics > Report a problem**.  On the first screen, when the login won't work, **Report a problem** sits beside **View log**.
2. Scan the QR code with your phone (or open the address on a computer).  The web editor opens on **Report a problem**, signed in.
3. Say where the problem is and what happened.  The TV adds its TiviBro version, TV model and webOS, a few settings, and the app and network helper logs.  Everything that will be shared is shown on the page first.
4. **Save the log file**, then **Open the GitHub form**: it is filled in with what you typed, the TV's details and the recent errors.  Drag the log file in and press **Create**.  You need a free GitHub account.

Before the report leaves the TV, usernames, passwords and tokens are masked and every provider, guide and unknown server name becomes `<provider>`, `<guide>` or `<server>`.  After a crash, TiviBro says so the next time it starts and points you here.

## Install

### Homebrew Channel (rooted TVs)

The easiest way on a rooted TV, with updates from the TV itself:

1. Open the **Homebrew Channel**, go to **Settings**, and choose **Add repository**.
2. Enter `https://tivibro.app/repo`
3. TiviBro appears in the Homebrew Channel's app list.  Open it and choose **Install**.  New versions show up there as **Update** (and inside TiviBro under **Settings > Updates and about**).
4. Open TiviBro and scan the QR code on the first screen with your phone to add your playlist there.

Want every test build as soon as it's out?  Add `https://tivibro.app/testing` instead.  Until the first full release, both addresses give you the newest test build.

> The short addresses are served by the website and always match the files on the `homebrew` branch, so `https://raw.githubusercontent.com/ohmybahgosh/TiviBro/homebrew/repo.json` (and `repo-testing.json`, `install.sh`) keep working too.

> Test builds show a plain-number version in the Homebrew Channel, such as `0.5.10005` for 0.6.0 alpha 5.  webOS only accepts numbers, and test builds have to sort below the release they lead up to.  TiviBro itself shows the real name.

### Developer Mode (works today)

1. Put your TV in [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) or use a rooted TV.
2. Build and install from this repository:

```bash
npm install                    # installs the webOS CLI (ares-*) locally
npx ares-setup-device          # add your TV (IP, port 9922)
npm run build                  # dist/app.tivibro.tv_<version>_all.ipk
npm run install:tv             # install on the TV
npm run launch
```

### Rooted TV: one line

On a rooted TV, one line does it all.  Switch on SSH (or Telnet) in the Homebrew Channel, log in as `root`, and run:

```bash
curl -fsSL https://tivibro.app/install | sh
```

It downloads the newest release (or, until the first full release, the newest test build), checks its SHA-256, installs it and starts TiviBro.  Run it again any time to update; settings are kept.  Options go after `sh -s --`:

```bash
curl -fsSL https://tivibro.app/install | sh -s -- --pre              # newest test version (alpha, beta)
curl -fsSL https://tivibro.app/install | sh -s -- --tag v0.6.0        # a specific release
curl -fsSL https://tivibro.app/install | sh -s -- --ipk /tmp/app.ipk   # an IPK you copied over
```

#### Or copy the IPK yourself

On a rooted TV with SSH switched on in the Homebrew Channel (user `root`, port 22), copy the IPK from a [release](https://github.com/ohmybahgosh/TiviBro/releases) to the TV and install it with the TV's own installer:

```bash
scp -O app.tivibro.tv_0.6.0_all.ipk root@TV_IP:/tmp/tivibro.ipk     # -O: the TV's SSH has no SFTP
ssh root@TV_IP
luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/tmp/tivibro.ipk","subscribe":true}'
```

Wait for `"state": "installed"`, press <kbd>Ctrl</kbd>+<kbd>C</kbd>, then `rm /tmp/tivibro.ipk`.  Installing a newer IPK the same way updates TiviBro and keeps your settings.  To start it from the shell as root: `luna-send -n 1 'luna://com.webos.applicationManager/launch' '{"id":"app.tivibro.tv"}'` (newer TVs refuse this over `luna-send-pub`).

If `scp` fails, pipe the file instead: `cat app.tivibro.tv_0.6.0_all.ipk | ssh root@TV_IP 'cat > /tmp/tivibro.ipk'`.

### Updating

TiviBro checks for a new release once a day (**Settings > Updates and about**).  On a rooted TV with the Homebrew Channel, **Install** there downloads it, checks it and installs it, and TiviBro restarts on the new version with all your settings.  On other TVs it shows the new version; install it the same way you installed TiviBro.

### Moving from another TV

On the old TV, open the web editor, then **Backup and restore > Download locked backup**.  On the new TV, choose **Set up or restore from a computer** on the first screen and restore the file with its passphrase.

## Develop

Want to help?  [CONTRIBUTING.md](CONTRIBUTING.md) has the ground rules and how to report problems; security problems go through [SECURITY.md](SECURITY.md).

TiviBro is plain HTML, CSS and JavaScript, with no bundler and no build step beyond packaging.  The same IPK runs from webOS 4 (Chromium 53) to webOS 26, with webOS 25 as the main target; see [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).  A small webOS JS service acts as a localhost relay (CORS, custom User-Agent) and hosts the LAN web editor.

```
app/              The webOS web app (what runs on the TV)
  appinfo.json    App manifest (id, version, icons, splash)
  js/             App modules (see docs/ARCHITECTURE.md)
  css/  img/      Styles, icons, splash and logo
  vendor/         hls.js and mpegts.js, unmodified
service/          webOS JS service: localhost relay + LAN web editor (service/editor/)
tests/            Unit tests (Node), Playwright suites, dev relay
scripts/          build, install, launch, sim, inspect, serve, lint, bump-version
logos/            Brand artwork; logos/clean/ holds the cleaned, ready-to-use files
docs/             Architecture, decisions, roadmap, simulator guide, TiviMate parity
```

| Command | What it does |
|---|---|
| `npm run build` | Package `app/` + `service/` into `dist/app.tivibro.tv_<ver>_all.ipk` and check its layout |
| `bash scripts/build.sh --dev` | Same, unminified, for readable DevTools |
| `npm run install:tv` | Install the built IPK on the TV (`-- -d <tv>` to pick one) |
| `npm run launch` | Launch TiviBro on the TV |
| `npm run sim` | Run the app in the LG webOS 25 Simulator, streaming logs to `logs/latest.log` (see [`docs/SIMULATOR.md`](docs/SIMULATOR.md)) |
| `npm run inspect` | DevTools for the app on the TV (`bash scripts/inspect.sh -s` for the service) |
| `npm run serve` | Run the app in a desktop browser at http://localhost:8078 with the dev relay |
| `npm run lint` | Syntax-check every JS and JSON file |
| `npm test` | Unit tests: name cleaner, Smart clean-up engine, logo library and index, relay, web editor (including encrypted backups), library |
| `npm run logos` | Build the channel logo index into `site/logos/` (the Website workflow does this on every deploy and every Monday) |
| `npm run soak:tour` | The set-up tour driven with the remote in a real browser |
| `npm run soak:editor-mobile` | The web editor on phones and tablets: every page fits, the page list, one pane at a time, menus and dialogs on screen |
| `bash scripts/bump-version.sh X.Y.Z` | Set the version everywhere it appears |

### Demo media

Every GIF, video and TV screenshot in this README and the [user guide](docs/USER-GUIDE.md) is recorded from the real app against a made-up provider, so they can be refreshed after any UI change:

```bash
bash scripts/demo/make-media.sh          # once: synthetic demo streams (needs ffmpeg)
node tests/mock/mock_provider.js &       # fictional Xtream provider on :8077
npm run serve                            # app on :8078 plus the dev relay
node scripts/demo/record.js              # record every scene (or name some: guide zap)
                                         # plus every Settings page and editor page as screenshots
bash scripts/demo/encode.sh              # GIFs and MP4s into docs/media/
```

### Releasing

Releases are built by GitHub Actions.  Every push and pull request also runs lint, tests and a test build ([CI](.github/workflows/ci.yml)).

1. `bash scripts/bump-version.sh X.Y.Z`
2. In [`CHANGELOG.md`](CHANGELOG.md), rename `## Unreleased` to `## X.Y.Z (date)`, then commit.
3. `npm run release`.  It checks everything locally, then tags `vX.Y.Z` and pushes the tag.

The [Release workflow](.github/workflows/release.yml) then runs the tests, builds the IPK, writes the Homebrew Channel manifest and `repo.json`, and publishes a GitHub release with the CHANGELOG section as its notes.  For a pre-release, `npm run release -- alpha.1` tags `vX.Y.Z-alpha.1`; tags with a dash become pre-releases.

## Privacy and security

- Provider logins stay on the TV.  The web editor only ever sees server names, never usernames, passwords or stream links.
- The web editor is off at every start (except on a brand-new TV with no playlist, for the setup QR code), needs the password shown on the TV, and locks out after repeated wrong tries.
- Backups are always encrypted with a passphrase you choose.  Without it the file cannot be opened.
- Logs mask usernames and passwords.  **Report a problem** also replaces every provider, guide and unknown server name before anything leaves the TV, and nothing is sent until you press the button on GitHub yourself.
- The logo library, when you turn it on, downloads lists of logo addresses from tivibro.app, one per country in your playlist, then each logo from its project.  Only the country is in the request: no channel names, logins or anything else from your playlist.

## Credits

Made by **[OhMyBahGosh](https://github.com/ohmybahgosh)**.

Playback uses [hls.js](https://github.com/video-dev/hls.js) and [mpegts.js](https://github.com/xqq/mpegts.js).  QR codes by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).  Channel logos in the logo library come from [iptv-org/database](https://github.com/iptv-org/database) and [tv-logo/tv-logos](https://github.com/tv-logo/tv-logos), loaded from those projects; the logos belong to their channels.  Thanks to the [webOS Homebrew](https://www.webosbrew.org/) community.

TiviBro is an independent project.  It is not affiliated with LG Electronics or with TiviMate; those names belong to their owners.

## License

[MIT](LICENSE)
