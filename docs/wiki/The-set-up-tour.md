<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*On the TV*

Right after a new playlist connects, TiviBro shows what it has and walks you through making it yours, one screen at a time with the remote.  It only asks about what your playlist actually has, so a list with no local stations never shows the city step.  Nothing changes until the last screen, and a restore point is saved first, so the web editor can put everything back.

<p align="center">
  <a href="https://tivibro.app/view/#tv-tour-welcome"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-welcome.png" width="49%" alt="The tour's first screen: what the playlist has"></a>
  <a href="https://tivibro.app/view/#tv-tour-phone"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-phone.png" width="49%" alt="Scan a code to tidy up on a phone"></a>
</p>

The first screen counts your channels, groups, countries, event channels, East and West copies, local cities, extra copies and whether there are movies and shows.  Then:

- **Tidy up here, step by step** goes through the screens below.  The chip in the top corner keeps a running count ("Keeps 3,632 of 9,808 channels").
- **Tidy up on a phone or computer** shows a QR code.  Scan it with your phone's camera and the web editor opens on [Smart clean-up](Smart-clean-up), already signed in.  The address and password are there too, for a computer.
- **Skip, start watching** changes nothing.

| Screen | What you pick |
|---|---|
| **Countries** | Each country and region in the list, biggest first, with how many channels it has.  The TV's own country is ticked; **Keep every country** and **Keep only** the biggest are one press.  Groups with no country (sports, events, 24/7) are kept unless you say otherwise. |
| **Channel names** | Name clean-up on or off, group names too, and every rule, with your own channels shown before and after. |
| **East or West?** | Keep East feeds, West feeds or both, and whether to hide groups named West (or East).  Examples from your list. |
| **Your local channels** | Every city your provider's local groups carry, A to Z, with the networks in each.  **OK** ticks a city; ◀ ▶ jump between letters.  The other cities' stations are hidden in every local group.  **Put them together in "Local channels"** (on) makes one group with your stations, by city and network, and **Then hide the network groups** (on) puts ABC Locals, CBS Locals and the rest out of the way so each station shows up once. |
| **Sports and pay-per-view** | [Event channels](Event-channels-pay-per-view-and-sports-passes): reading events from names, short names, Events by time, the time zone for names without one, and **Hide channels with nothing on**.  The next events are listed. |
| **Clear the clutter** | Divider groups, empty groups, the same channel more than once (keep Full HD, the default, or the best, HD, SD or every copy; the copies you hide are still backups: TiviBro switches to one by itself if yours stops working, and they stay under hold OK > Other versions), groups with words like PPV or Adult, and whether groups the provider adds later show up. |
| **Channel logos** | The [logo library](Channel-logos), its style, and which logo wins when the playlist and the guide both have one, with logos it found for your channels. |
| **Make it yours** | Accent colour, background, text size, start screen, turning on the last channel at launch, the preview in the list, and what happens when a channel stops working.  Colours change as you pick them. |
| **All set** | How many channels and groups you keep and hide, **Your choices** (one line per screen, like "Detroit in Local channels, network groups hidden": **OK** on one goes back to that screen, and **Skip to the summary** comes back), **Apply and start watching**, and a few things worth knowing. |

**Hidden, not gone.**  Everything the tour hides stays one press away in **Settings > Groups, sorting, hidden**, and Apply saves a restore point first.  Good to know about what hiding does:

- **Extra copies** you hide are still backups: if the copy you keep stops working, TiviBro switches to one of them by itself.  See [Other versions of a channel](Other-versions-of-a-channel).
- **The other East or West feed** is not a backup, because it runs hours apart.
- **Network groups** hidden after **Put them together in "Local channels"** don't take your stations with them: they stay in Local channels.
- **Hidden groups and channels** leave the guide, All channels, Search and the watchlist (unless **All channels includes hidden groups** is on).
- **Channels with nothing on** come back by themselves when an event is named.

<p align="center">
  <a href="https://tivibro.app/view/#tv-tour-countries"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-countries.png" width="32%" alt="Countries"></a>
  <a href="https://tivibro.app/view/#tv-tour-names"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-names.png" width="32%" alt="Channel names"></a>
  <a href="https://tivibro.app/view/#tv-tour-feeds"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-feeds.png" width="32%" alt="East or West"></a>
</p>
<p align="center">
  <a href="https://tivibro.app/view/#tv-tour-locals"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-locals.png" width="32%" alt="Your local channels"></a>
  <a href="https://tivibro.app/view/#tv-tour-events"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-events.png" width="32%" alt="Sports and pay-per-view"></a>
  <a href="https://tivibro.app/view/#tv-tour-clutter"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-clutter.png" width="32%" alt="Clear the clutter"></a>
</p>
<p align="center">
  <a href="https://tivibro.app/view/#tv-tour-logos"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-logos.png" width="32%" alt="Channel logos"></a>
  <a href="https://tivibro.app/view/#tv-tour-look"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-look.png" width="32%" alt="Make it yours"></a>
  <a href="https://tivibro.app/view/#tv-tour-done"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-tour-done.png" width="32%" alt="All set"></a>
</p>

Everything the tour hides stays one press away: Settings > Groups, sorting, hidden, or hold **OK** on a channel.  Run it again any time from **Settings > Playlists and guide > your playlist > Set-up tour**.  It works on the same engine as the web editor's Smart clean-up, so both always agree.

---

← [First start](First-start)  ·  [Home](Home)  ·  [Channel logos](Channel-logos) →
