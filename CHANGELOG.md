# Changelog

## Unreleased

- **Reminders while TiviBro is closed.**  The network helper schedules each reminder with the TV, so at reminder time the TV shows an alert (**Watch** / **Dismiss**) over whatever is on, another app or an HDMI input included.  **Watch** opens TiviBro straight on the channel; if the programme started a while ago and the channel has catch-up, it offers to start from the beginning.  TVs that refuse alerts get a toast that opens the channel when selected.  The TV has to be on: nothing shows from standby.  While TiviBro is on screen it still asks itself, and the TV stays quiet.
- Reminders no longer disappear unseen.  One that came due while TiviBro was in the background, or behind a menu, waits and asks when you're back ("Started at 8:00 pm", with **Watch from the start** on catch-up channels), and one that ended meanwhile is offered from catch-up ("You missed it").
- **Search the whole guide, now and to come.**  Search finds every showing of a programme in the loaded guide, soonest first, with **Today**, **Tomorrow** or the day.  Filters under the box: **Everything**, **On now**, **Coming up**, **Replays**, **Channels**.  A programme carried by several copies of a channel shows once.  OK on an upcoming one sets a reminder, and OK again cancels it.  Before, a common word could stop at the first 120 matches the guide happened to hold and miss tonight's showing; pay-per-view and event channels are searchable too.
- **Watchlist.**  Shows, teams and names to look for in the guide ("Yankees", "Bluey", "Gordon Ramsay").  When one is coming up, TiviBro sets a reminder and says so.  Whole words only, a cancelled reminder stays cancelled, and a busy word keeps at most five reminders waiting.  Add from **Yellow** in Search, **Hold OK > Add to watchlist** in the guide (which also has **Other showings…**), Settings > Guide, start screen, reminders > **Watchlist**, or the web editor's Guide page.
- **Preferred audio and subtitle language.**  Settings > Playback > **Audio language** picks that track when a stream has several (skipping audio description), **Prefer surround sound** picks the 5.1 or Dolby one, and **Subtitles automatically** can be limited to one language.
- **Recently added channels.**  Channels that are new in the playlist since it last loaded get a **Recently added** group and a **NEW** tag for a week (3, 7 or 14 days, or off, in Settings > Groups, sorting, hidden).  A reload where almost everything changed, like a new server, marks nothing.
- **Your own channel order in provider groups.**  **Hold OK > Move…** on a channel carries it with ▲ ▼ (CH +/− a page) in any group, the provider's included; the order survives playlist refreshes and new channels go to the end.  **Back to the provider's channel order** on the group undoes it.  In the web editor, **Order: Your order** works for provider groups, and every channel's **⋯** has Move to the top, up one, down one, to the bottom and to a position, so phones can reorder too.
- **Speed test.**  Settings > Diagnostics > **Speed test** measures your internet and your provider (part of a movie, or a live channel), says what that's enough for (4K, Full HD, HD) and which side is slow.
- **Faster long lists.**  Holding ▲ or ▼ speeds up the longer it's held, and the channel list shows **CH +/− page** when a group is longer than the screen.
- **Fix:** since alpha 14, Settings sections below Playlists opened the wrong page (Guide, start screen, reminders showed Appearance, and so on).  Each section opens its own page again.

## 0.6.0 (alpha 16, 2026-10-30)

Pre-release: expect rough edges, and keep a backup before installing.

### New in alpha 16

- **Send a report without a GitHub account.**  The web editor's **Report a problem** page has **Send report**: one tap and it becomes an issue on TiviBro's GitHub page (labelled from-tv), with the log folded underneath and a link to follow it.  It goes through a small relay (relay/ in the repo, a Cloudflare Worker) that masks logins and server names again and limits how many reports one network can send.  The GitHub form is still there for people who want replies by email.
- README and tivibro.app explain **Report a problem**: a README section with the steps and what gets masked, a row in "What no other IPTV player does", an FAQ answer and feature cards on the website, and the footer's Report a bug link opens GitHub's issue forms.

### In alpha 15

- **Report a problem.**  Settings > Diagnostics > **Report a problem** shows a QR code.  Your phone opens a new **Report a problem** page in the web editor: say what happened, read everything the TV adds (version, TV model, a few settings, the app and network helper logs), save the log file, and **Open the GitHub form** opens a bug report already filled in.  Logins, tokens and every provider and guide server's name are taken out first.
- **Report a problem from the first screen** too, for when the login won't work: a **Report a problem** button beside View log shows the QR code (without a Turn off button there, since the first screen needs the editor), and the editor's Report a problem page is open before a playlist is added.  Any server address in the report that TiviBro doesn't know yet, like one typed but not saved, is replaced with <server>.
- After a crash, TiviBro says so once at the next start and points to Report a problem.
- tivibro.app now counts visits with Google Analytics 4, only after a visitor presses **Allow**; **Cookie settings** in the footer asks again.  It records install buttons, install tabs, copied install steps, GitHub links, demo videos, FAQ questions and which sections people read.  The TV app still has no analytics.

### In alpha 14

- **Edit on phone, one press away.**  The side menu has **Edit on phone** (between Search and Settings): it turns the web editor on and shows its QR code, address and password over whatever you're on.  **Done** leaves it running; **Turn the editor off** stops it.  The same panel is under hold OK on any group, at the top of **Settings > Edit on a phone or computer** (renamed from Edit on a computer, and moved up under Playlists), and can go on any remote button in Settings > Remote control.

### In alpha 13

- **Guide: a slimmer groups panel.**  The groups list now covers the channel column and no more, instead of a wide panel over the programmes (with logos only, it stays narrow too), and channel numbers no longer peek out beside it.  A group name too long to fit scrolls across while it's focused.
- **Local channels in one group.**  Smart clean-up's **Local channels: pick your city** can also copy the stations you keep into one group, "Local channels" or a name of your own, by city and network, and then hide the network groups (ABC Locals, CBS Locals and the rest) so each station shows up once.  The set-up tour does the same, both on by default.
- **Duplicates without the endless scrolling.**  **Same channel, more than once** opens on **To check**: only the channels where TiviBro couldn't tell which copy to keep.  **All** lists every set on one line, with a button per copy (FHD, HD, SD) to click the one to keep; **Find a channel** narrows the list, and **Hide extra copies** works on what was found.
- **Set-up tour: your choices on the summary.**  The last screen lists one line per step ("Keep USA", "Keep East, other feed's groups hidden", "Detroit in Local channels, network groups hidden"…); OK on one goes back to that step, and **Skip to the summary** returns.  The summary now starts on **Apply and start watching**.
- Set-up tour: duplicates default to keeping the Full HD copy (the others stay under hold OK > Other versions, and TiviBro switches to one if yours stops working); the sports step is called **Sports and PPV** in the step list; the welcome card reads "channels in East + West"; and a logo library that can't be reached says so in plain words instead of a network error.
- tivibro.app: the floating badges over the hero are gone, and only the phone moves (gently); pictures stay put.  The guide and web editor videos open full screen with a tap (and a full-screen button), so they're readable on a phone, where the phone mock-ups no longer cover them.  The TiviBro and TiviMate comparison is redesigned: grouped rows, a highlighted TiviBro column with check, cross and partial marks, a header that stays on screen, and one card per row on phones.
- **tivibro.app, redesigned.**  A full-screen hero with the guide playing on a TV and the phone editor beside it, a feature grid, a scroll-through "set it up from your phone" story, a screenshot carousel with a full-size viewer, parallax sections for the tour, logos, sports and the web editor, and an install section with tabs.  Works on phones, and keeps still for people who turn off motion.

### In alpha 12

- **The network helper, explained.**  The first screen's Network row is now **Connection: Automatic (recommended)**, with a line saying what the network helper is (the part of TiviBro that runs in the background on the TV and fetches your channels, guide and streams) instead of "running on port 47811"; it only turns red with the reason when the helper isn't running.  Settings > Playback says the same; the user guide and FAQ have "What is the network helper?".
- README and tivibro.app lead with setting up from your phone: a "Set it up from your phone" section with the first screen and phone screenshots, a line in the hero, and the step in the install instructions.  The editor's welcome page on a fresh TV offers **Add your playlist** first, then **Restore a backup**.
- **Back twice exits.**  Back to the groups on the home screen now says "Press Back again to exit", and the next Back closes TiviBro.  Before, the message showed but the second Back opened the menu again, so there was no way out with the remote; the first screen ignored Back altogether.  Closing also tries the system's own exit if the TV ignores the first one.
- **First screen: a QR code for your phone.**  A brand-new TV shows a QR code beside **Add your playlist**.  Scan it and the web editor opens on your phone, signed in, to type the login with a real keyboard or restore a backup; the TV switches to the playlist and opens the set-up tour.  **Set up or restore from a phone or computer** shows the same code full size.  The web editor starts by itself only on a TV with no playlist yet.
- First screen: the Connect, Test connection and other buttons were below the bottom of a 1080 screen; the screen now scrolls to whatever is focused.
- The Homebrew Channel listing has screenshots and a formatted description (features, what to know, links), from `site/hb/description.html` on the website, and says it needs webOS 4 or newer.

### In alpha 11

- The newest release is picked by date everywhere.  GitHub lists releases by tag name, so v0.6.0-alpha.9 came before v0.6.0-alpha.10: the website showed "Newest: 0.6.0 alpha 9" and the one-line installer (`tivibro.app/install`) installed alpha 9.  The website, the installer and the in-app updater now read all releases and take the newest (the updater already compared versions, but only read 15).  Test: `tests/unit/tv-install.test.js` lists alpha.9 before alpha.10 the way GitHub does.

### In alpha 10

- **Short addresses on tivibro.app.**  In the Homebrew Channel, add the repository `https://tivibro.app/repo` (or `https://tivibro.app/testing` for every test build).  On a rooted TV: `curl -fsSL https://tivibro.app/install | sh`.  The website serves the files from the `homebrew` branch as they are, refreshed after every release, so the long raw.githubusercontent.com addresses keep working too.  Also `tivibro.app/guide`, `/wiki`, `/download`, `/changelog`, `/issues` and `/github`.
- **The set-up tour.**  Right after a new playlist connects, TiviBro shows what it holds (channels, groups, countries, event channels, East and West copies, local cities, extra copies, movies and shows) and walks through making it yours, one screen at a time with the remote:
  - **Countries**, biggest first, with the TV's own country ticked.  **Channel names**, every rule, with your own channels before and after.  **East or West**.  **Your local channels**, every city A to Z (◀ ▶ jump letters).  **Sports and pay-per-view**.  **Clear the clutter**: divider groups, empty groups, duplicates (keep Full HD, the best, HD or SD), groups with words like PPV, and groups the provider adds later.  **Channel logos**.  **Make it yours**: accent, background, text size, start screen and more, live.  **All set**: what you keep and hide, and tips.
  - It only asks about what the playlist has, keeps a running count ("Keeps 3,632 of 9,808 channels"), and changes nothing until **Apply**.  A restore point is saved first, so the web editor can undo it.
  - **Tidy up on a phone or computer** shows a QR code that opens the web editor's Smart clean-up on your phone, already signed in.
  - Run it again from Settings > Playlists and guide > the playlist > **Set-up tour**.
  - On the real 9,808-channel provider: opens in about 0.15 s, and the count it promised (3,632 after USA, East, Detroit and Lansing) is what the lists show after Apply.  Tests: `tests/soak/tour.js` (`npm run soak:tour`), and the tour on every old TV engine in `tests/engines/run.sh browser` (Chromium 53 to 87).
- **Channel logos from the logo library** (Settings > Appearance, or the tour).  Missing logos are filled in from two open projects, [iptv-org](https://github.com/iptv-org/database) (each channel's own logo) and [tv-logos](https://github.com/tv-logo/tv-logos) (one matching style for dark screens).  **Fill in missing logos** or **Use for every channel it knows**, in either style.  Matched by guide id, cleaned name and country, and call sign (or network) for local stations; event channels are left alone, and a provider logo that fails to load is swapped for the library's.  TiviBro hosts no images: a small index of addresses (tivibro.app/logos/, one file per country, built by `scripts/logos/build-index.js` on every website deploy and every Monday) is downloaded for the countries in the playlist and kept on the TV for a week.  On the real provider: logos for about 3,600 of 9,808 channels.  Tests: `tests/unit/logos.test.js`, `tests/unit/logo-index.test.js`.
- Smart clean-up has one engine for the TV and the web editor (`app/js/tidy.js`, copied to the editor like the name cleaner), rewritten to run on Chromium 53, so the tour and the editor always agree.
- Set-up tour layout: **Apply and start watching** is a button beside Back instead of a row between the totals and the tips; the tips sit in two columns that fit; lists scroll by whole rows (never half a row cut off at the top), with a fade at the edge when there is more; every value on the right lines up.
- **The web editor on phones.**  Below 700 pixels wide: the page name in a top bar opens the list of pages (Log out included), pages scroll as a whole so the title doesn't take a third of the screen, Groups and channels shows the groups and then a group's channels on their own screen with **‹ Groups** to go back, channel rows have a **⋯** menu (Rename, Copy or move, Take out), the guide matching list and duplicate sets stack instead of squeezing a table, the change bar fits on two lines, inputs are 16 px so phones don't zoom in, and dropdowns never run off the screen.  Touch screens show the row actions that used to appear only under the mouse.  Tablets get tooltips on the icon-only page list.  Test: `tests/soak/editor-mobile.js` (`npm run soak:editor-mobile`) on iPhone SE, iPhone 13, Pixel 7 and iPad Mini sizes.
- Web editor: an address ending in `#k=PASSWORD/page` signs in and opens that page (what the tour's QR code uses); the password leaves the address bar at once.
- Smart clean-up, **East and West feeds**: finds channels that come in both time zones ("HBO (EAST)" and "HBO (WEST)", "A&E" and "A&E (WEST)", groups like "USA WEST") and keeps the one you pick, hiding the other copies (and the groups named for them) in one step.  On a real provider: 76 channels in both feeds.
- Smart clean-up, **Local channels: pick your city**: reads the city out of every station in the local groups (ABC, CBS, NBC, FOX, CW, PBS, Telemundo, Univision, CBC, CTV, Global and more, in the "NET | CITY | CALL", "PBS | ST - CITY (CALL)" and "CW | CITY 56 CALL" styles).  Find your city, tick it or a few nearby, and every other city's stations are hidden in all the local groups at once.  On a real provider: 929 local stations in 321 cities, down to Detroit and Lansing in one click.  Test: `tests/unit/cleanup.test.js`.
- The mock provider with `MOCK_EVENTS=1` also has East and West feeds and local groups, for the demo screenshots.

### In alpha 9

- **Event channels.**  Pay-per-view, league passes and one-off games often have no guide; the provider writes the whole listing into the channel name ("NCAAB 001 | NORTH FLORIDA @ CHARLESTON SOUTHERN (M) | 12.18 11:00 AM | ESPN+").  TiviBro now reads those names:
  - The channel list shows the short tag ("NCAAB 001", "PPV 03", "ESPN+ 20") with the event under it.
  - The guide shows the event at its time, "Starts 7:30 PM: Kings vs Pelicans" before it and "Ended:" after, with the league, sport and network, and the full name, in the info panel.  A real guide always wins.
  - **Events by time**, a group with every event channel on now or in the next two weeks, soonest first.
  - Times are read in the zone the name gives (ET, EDT, PT, UK, CET... and "2:00AM UK/9:00PM ET"), with daylight saving built in for old TVs, and otherwise in the provider's zone or the one you pick.  Shown in the TV's own time.
  - Settings > Playlists and guide > the playlist > **Event channels**: on or off, short names, the group, the time zone, and the next few events.
  - On a real provider it read 1,250 event channels in about 45 formats ("Oct 29 7:30 PM", "Sat 15th Aug 8:00PM", "Saturday, 31 October 2026 12:30", "12.18 11:00 AM", "14/08", "2026-02-08 10:40", a time on its own, a time between the teams).  Tests: `tests/unit/events.test.js`, `tests/soak/events.js` (`npm run soak:events`, with `MOCK_EVENTS=1` on the mock provider).
- Tested against a real Xtream Codes provider (about 9,800 channels, 152 groups): the channel list loads in about 3 seconds, the provider's full XMLTV guide (84,000 programmes) in about 7 seconds, and channels start in 1 to 3.5 seconds with no page errors.  The test is `tests/real/xc.js`: it reads the login from a private file outside the repository and writes its report and screenshots there, with the username and password masked.
- HLS fixed for providers that redirect to a streaming server: many Xtream panels answer a channel's .m3u8 with a redirect to a tokenized server whose playlist lists the video pieces as `/hlsr/...` links.  Through the helper those pointed at the TV itself and failed with 404, so the HLS stream format, and the HLS fallback when a channel won't play, never worked on such providers.  The helper now rewrites those links (and full addresses on other servers) to go through it.  Channels whose MPEG-TS version the player can't decode (Dolby audio or HEVC on some TVs) now fall back to HLS and play.  Tests: `tests/unit/proxy-hls.test.js`, and `tests/engines/helper.js` on Node 0.12 to 22.
- Movies and Shows only show up when the provider has something in them.  A provider that lists show categories with no shows in them used to get an empty Shows tab; TiviBro now asks a few of the categories (small requests) and hides the tab when they are all empty.  An empty list says "This provider has no shows right now" instead of "Nothing here".
- Channel names, checked against a real provider's 9,800 channels (the recommended rules now tidy about 5,200 of them, up from 4,400):
  - Country and region prefixes know about 250 codes (CAR, ARG, CO, CR, PR, AFG, MY, CA-FR and so on) and decorative separators like "UK◈ Sky Store".
  - Category prefixes include Spanish ones ("DEP | TUDN 01") and package words.
  - Decorative symbols cover emoji, sport symbols, circled letters, arrows, shapes and ™, so "⚽ EPL 1" and "⫘⫘⫘ UK ⫘⫘⫘" come out clean, and a trailing "*" goes.
  - Three new optional rules, off by default: **Free streaming service prefixes** ("Pluto US | CNN Headlines", "TUBI | ION"), **Country codes and names at the end** ("CANAL 4 PAN", "BEIN SPORTS 5 (USA)"), and **Status notes at the end** ("FloHockey 39 - Off Air").
  - Rules added in a later version start at their default for playlists set up before them.
- **Hide channels with nothing on** (Channel name editor on the TV, Smart clean-up in the web editor): event channels named "Off Air", "Offline" or "No Event Scheduled" stay out of the lists while they say so and come back by themselves when an event is named on them.  Favorites keep theirs.  543 such channels on the real provider.
- Smart clean-up:
  - **Keep only your countries** now also reads country words ("Canada Sports", "France Cinema", "Latino / Mexico"), the code most of a group's channels start with, and the divider group a group sits under.  On the real provider it went from 2 countries to 22, and no longer offers NBC, NFL or NHL as countries.
  - **Divider groups** hides groups like "⫘⫘⫘ UK ⫘⫘⫘" that only split the list into sections.
  - Overview suggests both when they apply.

- A website at [tivibro.app](https://tivibro.app) (`site/`, published by the Website workflow with GitHub Pages), and the README covers event channels and the new clean-up tools.

### In alpha 8

- Web editor: unsent work can't be lost.  Drafts were already kept in the browser; now they are also saved on the TV a few seconds after each change (at least every 30 seconds while you work), and the bar says when ("Draft saved on the TV at 8:41").  A reload, a closed tab or another computer offers the newest unsent work back, from this browser or the TV.  Browser storage that is full no longer fails silently.
- Draft history (Changes and restore points): versions of your unsent work on the TV, one every 3 minutes or 20 changes, one before sending and before discarding, and any you name with **Save a version**.  **Open** returns to one (and can be undone); versions that reached the TV are marked as sent; throwing a draft away keeps it here.  Each version holds only the edits (about 200 KB for 12,000 changes on a 15,000-channel playlist); up to 8 MB per playlist, oldest automatic versions dropped first, removed with the playlist.  Tests: `tests/soak/drafts.js` (`npm run soak:drafts`), `tests/unit/editor.test.js`.

### In alpha 7

- Web editor audit (`npm run soak:editor`, `tests/soak/editor.js`): every page driven in a real browser against the TV, checking what reaches it.  Login and lockout, groups, renames, your own groups, copying channels, favorites and hiding, name rules, guide sources, smart clean-up, restore points and undo, adding a playlist, backup and unlock, help and log out all work.
- Web editor fix: switching the editor off now drops changes and actions the TV hadn't picked up yet, and starting it again skips saves from an earlier session.  Before, a TiviBro that restarted (after switching playlist or a restore) could apply a stale save to the wrong playlist, or run a queued restore again.  Test: `tests/unit/editor.test.js`.
- Web editor fixed: since alpha 3 it opened as a blank page (a stray apostrophe in its help text stopped the page's script), so setup from a computer, editing and backup and restore didn't work.  Lint now checks the scripts inside HTML pages, so this can't slip through again.
- Parental controls: blocking the channel that's playing (the preview, say) now stops it, so OK can't take it fullscreen without the PIN.
- Documentation: every setting explained with its choices and default, one page per Settings section ([user guide](docs/USER-GUIDE.md#every-setting) and wiki), and pictures for everything.  New videos: the Channels screen and channel options, other versions of a channel, reminders, parental controls, and the fullscreen options.  New screenshots: every Settings section and the pages inside them, a channel switching to another version by itself, and every page of the web editor.  All media re-recorded from the current app.
- `scripts/demo/record.js` finds its way by watching where the focus is instead of counting key presses, and records the Settings pages and editor pages too.  The engine test picks a free port for the web editor.
- Run on the real engines of older TVs (`npm run test:engines`, [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) "Run on the real engines"):
  - The helper on Node 0.12, 8.12, 12, 16 and 20 (webOS 4 to 26): 40 checks covering relaying, Range, redirects, User-Agent, zipped guides, MPEG-TS realignment, sloppy replies, the DNS cache, errors, timeouts, zapping away, the web editor with encrypted backups, and the service wrapper.  All pass on every version.  `tests/engines/helper.js`, also part of the unit tests.
  - The app in Chromium 53, 69, 78 and 87 (Electron 1.4, 4.2, 7.3 and 11.5; webOS 4, 5, 6 and 22): start-up, channels, guide, remote keys, a playing preview, Settings, a zipped XMLTV guide, no page errors.  All pass, with screenshots.  `tests/engines/browser/`, `tests/engines/run.sh`.
- Sloppy providers on webOS 5 and 6, and `Content-Length` twice on webOS 22 and later: Node 8 refused replies with a stray control character in a header, and Node 12 and newer refused a repeated `Content-Length` even in lenient mode.  When Node refuses a reply, the helper now asks again with its own forgiving reader (`service/rawhttp.js`: CRLF or bare LF, control characters dropped, matching repeated lengths kept, chunked replies undone).  Tests: `tests/unit/proxy-lenient.test.js`, `tests/engines/helper.js`.
- Mock provider: `/guide.xml.gz`, a zipped guide labelled the way many guide hosts do.

### In alpha 6

- Quicker starts, same stability (buffer profiles unchanged):
  - CH+ / CH− and Last channel: a lone press starts the channel at once instead of after 300 ms; presses in quick succession still wait until you stop, so surfing opens one stream rather than many.  A single press to a moving picture went from about 0.72 s to 0.15 s against the mock provider (and 0.42 s to 0.15 s with a provider that allows one connection).
  - Channel numbers: switch as soon as the number can't get any longer (typing 12 when there is no 120 or longer), instead of waiting 1.4 s for another digit.  Same in the guide.
  - The helper keeps DNS answers for a minute (dropped when connecting fails), so channel changes and redirects don't wait on the TV's resolver.  Node 20's list form is supported; Node 0.12 ignores it.  Test: `tests/unit/proxy-dns.test.js`.
- Faster channel changes.  Until the first frame, the player checks every 50 ms whether enough is buffered, instead of on its 400 ms watchdog.  Video is usually ready 100 to 200 ms after a change, so pictures now appear about 300 ms sooner: 0.42 to 0.12 s in a desktop browser, and 0.86 to 0.47 s with the CPU slowed to TV speed (median of 10 changes).  Test: `player.test.js`.
- Player audit (`docs/COMPATIBILITY.md`, "Video decoding and hardware"): every stream already uses the TV's hardware decoder, demuxing runs in a background worker, and steady playback costs about 1% of a core.  Measured and left as they are: the demux worker (no measurable cost to channel changes) and the MPEG-TS stash buffer (resizes itself after the first second).
- Test channel "Chaos Real Time" (912): no head start, data at exactly real time from the first byte.
- Compatibility pass across webOS 4 to 26 ([`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)):
  - HEVC channels on webOS 4: mpegts.js uses `padStart` (Chromium 57) when it reads an HEVC stream, and hls.js uses `Object.entries` (Chromium 54).  `compat.js` now polyfills both, plus `Object.values` and `padEnd`.
  - Never a black screen: on webOS 3 and older the app says the TV is too old (needs webOS 4, 2018 or newer); if part of the app fails to load or start, it says so with the details and OK tries again.
  - Logos and posters on older TVs: an https image that fails (2018 to 2020 TVs without updates don't trust today's Let's Encrypt certificates) gets one more try through the helper.
  - Symbols (↺ ★ ▶ ✓ ⚠) on every TV: a 4 KB fallback font (subset of DejaVu Sans) for TVs whose fonts lack them; the Settings text no longer uses the emoji-only ⏪ ⏩.
  - Less memory for big guides: past programmes are kept only for catch-up channels, the rest keep the last three hours (on a 15,000-channel, 211 MB guide: 128 instead of 163 MB).  webOS 4 and 5 keep shorter programme descriptions.
  - Sloppy providers on webOS 22 and later: the helper uses Node's lenient HTTP parser, so replies with stray control characters in headers or bare LF line endings work as they did on older TVs.  Tests: `tests/unit/proxy-lenient.test.js`.
  - webOS 26 (Chromium 132) is recognised as 26.
  - A full storage no longer loses changes silently (one message, and it's logged), and an aborted guide-cache write no longer leaves anything waiting.
  - `compat.test.js` now also checks the bundled players, the stylesheets (CSS Chromium 53 ignores), the polyfills, the "too old" screen, version detection, the symbol font and `appinfo.json`; `npm run soak:boot` checks the start-up screens in a browser.
- Backup versions of a channel.  When a live channel stops working for good, TiviBro switches to another version of the same channel (another quality, group, or a copy you hid) and says so, steadiest first: Full HD, HD, unmarked, 4K, SD.  If every version fails (the provider is down), it goes back to the channel you chose and keeps retrying, so the picture still returns by itself.  **Settings > Playback and buffering > When a channel stops working**: switch, ask me, or keep retrying.  **Other versions…** in channel options and the quick menu.  Matching keeps countries, East/West feeds and numbered channels apart (`Library.versions`).  Tests: `tests/unit/library.test.js`, `npm run soak:backup`.
- Quality tags (FHD, HD, SD, 4K) beside channel names in lists and the guide, where the same channel appears more than once.
- Faster guide on big playlists.  Scrolling moves rows instead of redrawing them and reuses programme cells, the time header is rebuilt only when the time window moves, and the details panel waits until the remote rests while an arrow is held.  Measured on 15,000 channels with the CPU slowed to TV speed: a step down 56 to 33 ms, holding Down 18 to 24 rows a second with no long tasks (was 15), page down 150 to 114 ms, and a fifth of the DOM churn.  The channel list's info panel also waits while an arrow is held.
- Quick menu: line icons instead of mixed symbols, the row slides to keep the highlighted button in view when there are more than fit, moving only moves the highlight (opening it went from 139 to 18 ms), and a new **Other versions** button.
- Guide rows: the catch-up mark is just ↺ (the days are in the details), leaving room for names.
- Stream info no longer shows the previous channel's numbers while a channel is connecting.
- Speed and backup tooling: `npm run soak:speed` (key-to-screen times and held-arrow scrolling, CPU slowed to TV speed), `MOCK_BIG=15000` for a provider-sized mock playlist, `npm run soak:backup`.

### In alpha 5

- Homebrew Channel repository.  In the Homebrew Channel, **Settings > Add repository** with `https://raw.githubusercontent.com/ohmybahgosh/TiviBro/homebrew/repo.json` (releases; until the first one, the newest test build) or `…/repo-testing.json` (every build).  The Release workflow keeps both on the `homebrew` branch, with the manifest inside each entry, since the Homebrew Channel can't read GitHub release links from the TV.  `scripts/update-homebrew-repo.js`, tests: `tests/unit/homebrew.test.js`.
- Every build has its own package version, so the Homebrew Channel sees updates between test builds: test builds sort below their release (`0.6.0-alpha.5` installs as `0.5.10005`, `scripts/pkg-version.js`).  TiviBro still shows the full name.  IPK links in manifests are absolute and pinned to their tag.
- One-line installer: now at `https://raw.githubusercontent.com/ohmybahgosh/TiviBro/homebrew/install.sh`, installs the newest test build while there is no full release yet, and prints the release name instead of the package version.
- The repository is public, with an active-development notice at the top of the README.
- Playback on sloppy streams, tuned against a new set of deliberately broken test channels (see below):
  - A cushion that grows: when a live channel keeps running dry, TiviBro waits for a bigger buffer before playing again, up to 20 seconds depending on the buffer profile, and lets it shrink back after three clean minutes.  The refill shows as *Buffering NN%*, and never waits more than about 4 seconds once the base buffer is there.
  - Timestamp jumps: when a provider's stream jumps back or ahead (an upstream restart), playback follows the stream instead of freezing on the old position.
  - Starvation: a refill that gets no new data for 4 seconds reconnects instead of waiting for the watchdog.
  - HTTP errors after a channel has played (a provider at its connection limit, a brief 404) reconnect on the same player instead of switching players.  Busy answers (403, 429, 503 and similar) get five tries before the next player.  Retries back off to at most 5 seconds, and the slow-retry phase tries every 6 seconds for the first 3 minutes before easing to every 15.
  - HLS recovers from network errors mid-stream by reloading, before reconnecting.
  - Corrupted MPEG-TS: the network helper keeps packets aligned (`service/tssync.js`), dropping stray bytes instead of passing them to the demuxer, which used to stall until the channel was reconnected.  Anything that isn't TS passes through untouched.  Tests: `tests/unit/tssync.test.js`.
  - mpegts.js: null guards for callbacks that arrive after the player was destroyed (fast zapping); documented in `app/vendor/PATCHES.md`.
  - Results in headless Chromium, percent of time the picture moved: corrupted data 68 to 100, mixed trouble 68 to 86, a 60-second provider outage 26 to 58 (back about 3 seconds after the provider returns), stalls 86 to 88.
- The guide opens in the grid on the last channel the first time, instead of on the group list.
- Soak tests (Playwright): `npm run soak:chaos` plays eleven broken test channels (`MOCK_CHAOS=1`, `tests/mock/chaos.js`) and reports freezes, reconnects and time moving; `npm run soak:zap` makes 300 fast channel changes and checks playback, memory and menus afterwards; `npm run soak:monkey` presses random remote keys across every screen looking for errors and dead ends.  `make-media.sh` now also writes the 10-minute `chaos.ts` clip.  See the Developing wiki page.

### In alpha 4

- Updates from the TV.  New **Settings > Updates and about** (`app/js/update.js`): shows the version, checks GitHub releases (once a day by itself, or on demand), lists what's new, and on rooted TVs with the Homebrew Channel installs the update through `luna://org.webosbrew.hbchannel.service/install` with the SHA-256 from the release manifest, then restarts into the new version.  "Include test versions" offers alpha and beta builds (on by default when running one).  Other TVs see the update and how to install it.  Tests: `tests/unit/update.test.js`.
- One-line installer for rooted TVs: `scripts/tv/install.sh`, published with every release as `install.sh`.  `curl -fsSL …/releases/latest/download/install.sh | sh` downloads the newest release, checks its SHA-256 against the manifest, installs it with the TV's installer and starts TiviBro; `--pre`, `--tag`, `--ipk`, `--sha256`, `--no-launch`.  POSIX sh for BusyBox, ES5 node for webOS 4.  Tests: `tests/unit/tv-install.test.js` (fake GitHub and installer).
- Release builds stamp the full version (for example `0.6.0-alpha.4`) into the app, so updates compare test versions correctly; `appinfo.json` stays `X.Y.Z`.  Release notes include the one-line install command.

### In alpha 3

- Zipped guides on every TV.  The network helper now unzips guide downloads (`service/unzip.js`, relay prefix `/unz/<id>`), so `.xml.gz` sources work on webOS 4, 5 and 6 too, where the browser has no `DecompressionStream`.  It also handles `Content-Encoding: gzip` and `deflate`, provider guides that are gzipped without saying so, and files zipped twice, and asks servers for compressed transfers.  Progress counts the zipped bytes (`/xfer/<id>`), so percent and time left stay right.  With Network set to Direct, older TVs get a clear message instead of a guide that silently fails.  Tests: `tests/unit/unzip.test.js`.

### In alpha 2

- webOS compatibility, one IPK from webOS 4 to 26 with webOS 25 as the main target ([`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md)):
  - `requiredACG` in `appinfo.json` (`systemconfig.query`, `activity.operation`), checked by webOS 26 and required from 27.
  - `app/js/compat.js`: `Promise.prototype.finally` for Chromium < 63, and flexbox `gap` detection; `app/css/nogap.css` (generated by `npm run nogap`) spaces flex layouts with margins on Chromium < 84 (webOS 6 and older).
  - Stream diagnostics no longer need `AbortController` (Chromium < 66).
  - `service/compat.js`: `Object.assign`, `Buffer.from` and `timingSafeEqual` for the old Node on webOS 4 and older.
  - `tests/unit/compat.test.js`: app parses on Chromium 53, helper on Node 0.12, no unguarded newer APIs, shims work, `nogap.css` current, ACG covers every Luna call.

### In alpha 1

- Streams that don't quit.  Reconnects wait a little longer each time (with jitter), a dropped Wi-Fi is waited out without spending retries and reconnects the moment the TV is online, and a channel that keeps failing tries the TV player and the provider's HLS version, then retries every 15 seconds for up to 20 minutes with a message on screen.  An HTTP error before the first frame gets two quick retries (a provider's connection limit while the last channel hangs up) before the next player, instead of marking the whole server for the TV player.  Movies and catch-up resume at the same spot after a drop, after leaving the app and coming back, and when the TV player reports "ended" mid-film.  Long-paused live TV lets the connection go and Play returns to live.  Error messages say what happened, and OK on them tries again from the top.
- HDR, Dolby Vision and codecs.  New `caps.js` reads what each stream is (HLS master playlist, mpegts.js media info, Xtream movie details) and routes it before the first frame: Dolby Vision to the TV player, HDR10 and HLG to the built-in player by default (**Settings > Playback > HDR and Dolby Vision** can send all HDR to the TV player), codecs MSE refuses to the TV player.  Known LG rules on top of what the TV reports: HEVC, AC-3 and E-AC-3 on webOS 4+, AV1 on webOS 5+, Dolby Vision 5/8 on the TV player, and no DTS on 2020 to 2022 models (C1, C2).  DTS-only and surround FLAC movies warn about sound.  The info panel and movie details show the format ("4K  HEVC  Dolby Vision 8  E-AC-3 5.1 Atmos").  **Diagnostics > What this TV can play** lists everything.
- hls.js full build instead of the light one, for separate audio tracks and subtitles in HLS.
- Remote and Magic Remote: Play and Pause do what they say; channel lists wrap and held arrows stop at the ends; Up at the top of a list no longer opens the menu; Info opens options in lists and the guide; the channel list over the video keeps open while you switch and closes on the playing channel; movie seeking speeds up as you keep pressing, previews the landing point and end time, and Back cancels it; confirmations focus Cancel; clicking outside a pop-up closes it; clicking the progress bar seeks; Settings rows show clickable ‹ › arrows.
- Appearance: nine backgrounds (new Ocean, Forest, Plum, Mocha and High contrast), twelve accents plus Custom (hue and brightness from the remote), colour swatches, text on the accent picks dark or white for contrast, and a "Filled with outline" focus style.
- Tests: `caps.test.js`, `player.test.js` (fake video and clock: reconnect, offline, retry ladder, resume, routing, live pause, suspend) and `look.test.js`.

- README rebuilt around recordings of the real app: animated walkthroughs of the guide, zapping, catch-up, groups, movies and shows, search, multiview and settings, plus the web editor and a fresh-TV restore shown side by side with the TV.  Every image opens full size, with a full-quality MP4 beside each animation.
- New [user guide](docs/USER-GUIDE.md) covering every remote button, screen and setting on the TV, every page of the web editor, backups and troubleshooting.
- GitHub wiki pages in `docs/wiki/`, built from the user guide (`npm run wiki`) and published with `npm run wiki:publish`.
- Demo tooling: a fictional Xtream provider with guide, catch-up, movies and shows (`tests/mock/mock_provider.js`), synthetic demo streams, and scripts that record and encode every clip and screenshot (`scripts/demo/`).
- Movies and shows: the details panel no longer sits under the clock.
- GitHub Actions: CI (lint, tests, test build) on every push and pull request, and a Release workflow on `vX.Y.Z` tags that builds the IPK, writes the Homebrew Channel manifest and `repo.json`, and publishes a GitHub release with notes from this file.  `npm run release` tags and pushes after checking everything locally.
- Renamed to **TiviBro**.  App ID `app.tivibro.tv`, helper `app.tivibro.tv.service`, storage keys `tivibro.*`.  On a TV this installs as a new app; remove the old one after restoring your backup.
- New logo: glossy blue "V" app icon (80 and 130 px), "tVb" splash screen, "tiviBro" wordmark on the first-run and loading screens and in the web editor, V mark in the side menu, editor favicon.  Cleaned artwork (speckles removed, light-background versions) lives in `logos/clean/`.
- Full, locked backups.  A backup now holds everything (settings, every playlist with its login, each playlist's edits and restore points) and is always locked with a passphrase: the helper encrypts it (AES-256-GCM, key from PBKDF2-SHA256, 200,000 rounds) before it leaves the TV, so the browser and the downloaded `.tivibro` file never hold readable logins.  "Suggest one" makes a strong passphrase.  Restoring sends the file and passphrase to the helper (`/api/restore`), which checks it (wrong passphrase or a changed file is refused), shows the playlists inside (names and servers only), then hands it to the TV.  Older unlocked backups still restore, with a warning.
- Fresh TV restore: the first-run screen has "Set up or restore from a computer", which starts the web editor and shows its address and password in big type.  The editor opens on a Welcome page (restore a backup, or add a playlist with a real keyboard) and moves on by itself once the TV has a playlist.  The first playlist added from the editor is switched to automatically.
- New look, "Midnight Electric": deep navy with electric blue and cyan, on the TV and in the web editor.  Amber stays only for warnings.  The old amber default switches over once; a colour you picked yourself is kept.  The old colours remain as the "Classic (1.0)" background, and the accent list gains Cyan, Violet, Mint, Teal and Ember.
- Web editor, usability overhaul:
  - Drafts and a change bar: edits stay in the browser until "Send to TV" (Ctrl+S), or switch on "Send automatically".  Review lists every pending change in plain words.  Drafts survive a page reload and are offered back.
  - Undo and redo (Ctrl+Z, Ctrl+Shift+Z) for every edit, plus a session history with "Go back" to any step.
  - Restore points on the TV (IndexedDB `snaps:<playlist>`): one automatically before each set of changes from the computer (last 15 kept) and named ones (up to 30).  Restoring makes a point first, so it can be undone.  New commands: listSnaps, makeSnap, restoreSnap, deleteSnap.
  - Copy or move channels into any group, provider groups included (new edits `groupAdd`, `groupRemove`), with "take out of this group" and a one-click "put this group back".  Provider groups show an "edited" tag.
  - Per-group sort dropdown (provider order, A to Z, Z to A, channel number, your order), new edit `groupSort`, honoured on the TV.
  - Your own groups show "renamed" after a rename (original kept as `orig`).
  - Custom dropdowns replace the browser's: a click opens the list and only a later click picks, so the opening click can no longer select the option under the pointer.  Type to filter, arrow keys work.
  - Guide page rebuilt: the provider's guide options are explained as cards (per channel, full XMLTV, off), Full XMLTV asks first, and guide loads now show live progress (MB, percent, speed, time left, programmes read).  Guide commands answer at once and load in the background, so nothing looks frozen.
  - Recommended free guides by region (epgshare01, iptv-epg.org, i.mjh.nz, dp247 Freeview on GitHub, iptv-org/epg), each with Test and Add.  Guide sources can be tested, reordered and given offsets.
  - Smart match: fuzzy name matching that understands quality tags, country codes, East/West feeds, numbered channels and US call signs, with confidence levels and approve/decline per guess.  Matching tabs: needs a guide, provider only, matched by you, matched on its own, waiting for the TV.  The manual picker ranks suggestions with a match percentage.
  - Smart clean-up page: keep only chosen countries (group name prefixes), duplicate finder with a preferred quality, hide by keyword with preview, hide empty groups.  Overview shows smart suggestions.
  - Help page with sections for every tool, and short notes with "Learn more" links on each page.  Busy bar, button spinners and elapsed-time messages for every TV action.
- TV: guide download progress (bytes counted as they arrive) in a corner chip and sent to the web editor (`/editor/progress`, returned by `/api/rev` with `tvSeen`).
- Tests: `tests/unit/library.test.js` (copy, move, take out, per-group sort); editor test covers progress.

### Earlier in this release
- Web editor redesigned: side navigation with Overview, Groups and channels, Guide matching, Channel names, Playlists, Backup and restore.
  - Overview: stats (channels shown, groups shown, hidden, favorites, own groups, guide coverage, catch-up), a five-step clean-up checklist, one-click clean-ups (hide all, recommended names, hide empty groups, show all).
  - Groups and channels: rename provider groups (new `groupRenames` edit, also used on the TV), filters (shown / hidden / without guide data), Sort A–Z for your groups, Find and replace across channel names (plain or regular expression, selected / group / all, with preview), catch-up badges.
  - Guide matching: coverage, provider guide mode, add/remove XMLTV sources, reload guide, list of channels without guide data, searchable picker that assigns a guide channel (`epgMap`).
  - Playlists: add Xtream Codes or M3U accounts (the TV logs in and loads before saving), use on the TV, reload, edit name / User-Agent / refresh intervals / login (tested before saving), delete.
  - Backup and restore: download a full backup (settings, all playlists with logins, each playlist's edits); restore from a file with a summary first; the TV restarts TiviBro and the editor reconnects by itself.
- Helper: command queue for actions the TV must carry out (`/api/command`, `/api/result`, `/editor/result`); more tests in tests/unit/editor.test.js.
- Edit on a computer (Settings > Edit on a computer): the network helper serves a web editor on the TV's address (port 8787, 8080, 8000 or 9090) behind a random 8-character password shown on the TV.  In a browser: show/hide and drag-reorder groups, create/rename/delete your own groups, search all channels, hide/show, rename, favorite, add to groups in bulk, reorder channels inside your groups, and edit the channel-name rules with a live preview.  Changes reach the TV within a few seconds; changes made on the TV show up in the browser.  Off at every app start, stops when the app closes; wrong passwords lock out for a minute after 5 tries; no provider address, login or stream links are ever sent to the browser.
- TiviMate settings review (see docs/TIVIMATE-PARITY.md).  Added:
  - Playback: per-channel picture size (or for all channels), HLS video quality, playback speed for catch-up and movies, subtitles menu and "subtitles on automatically", separate ⏪ ⏩ step, ◀ on catch-up channels can be Rewind or Last channel, black screen while switching, info panel on switching on/off, stream details in the info panel.
  - Guide: how what's on now is marked (progress fill / colour / off), channel names on/off (logos-only guide widens the schedule), two-line channel names, catch-up marks on/off.
  - Groups: Favorites group on/off, hide groups the provider adds later, All channels can include hidden groups.
  - Appearance: background theme (dark blue / black OLED / slate), text size, panel transparency over video, logo source (playlist or guide), date with the clock; the clock now sits top right on every screen.
  - Remote: choose which Quick menu buttons appear (TV guide button added).
  - Reminders: ask or switch automatically, how long the question stays.
  - Playlists: custom User-Agent per playlist, sent by the network helper (tests/unit/proxy-ua.test.js).
- Side menu replaces the top bar: icons down the left edge, labels when opened with ◀ (or the pointer), hidden in the guide grid and fullscreen.
- Guide layout: preview window top left; top right shows title, LIVE / CATCH-UP / UPCOMING, air time, length, time left, channel, group, catch-up days, a progress bar and the description.  Opening the guide shows the groups panel (▲▼ choose, the grid follows); ▶ enters the grid and hides the menu and groups; ◀ on what's on now brings them back.
- Previewed channel to fullscreen from anywhere in the guide: the Play button or clicking the window.  Back always goes up one level (grid, groups, menu), and Back on the home menu asks before exiting.  ("In the window: <channel>" stays on screen while you browse.)
- Fullscreen OK opens a TiviMate-style quick menu: channel list, watch from start (catch-up only), favorite, audio, subtitles (when present), picture size, multiview, sleep timer, stream info, reconnect, and a row of recent channels.  Remappable (Remote control settings); old remote maps migrate automatically.
- Movies and Shows only appear in the menu when the provider actually has them (checked in the background each launch).
- Bigger channel logos in the guide; live progress shown inside every on-now programme; catch-up channels marked "↺ 3d" and past programmes "↺"; schedule only goes into the past on channels with catch-up.
- Guide is now the home screen (Settings > Guide, start screen, reminders > Start screen).  Tabs: Guide, Channels (was Live), Movies, Shows, Search, Settings.  Back from any other screen returns to the Guide.
- Guide: preview window top right.  OK on a channel previews it there, OK again goes fullscreen (or fullscreen at once, via a setting).  Back from fullscreen returns to the guide with the picture still in the window.
- Guide: two-line programme cells (title and time), details panel with a two-line description and a line saying what OK will do.
- Guide: group switcher above the channel column.  ▲ from the first channel focuses it, ◀ ▶ change group, OK lists all groups with counts.  Number keys jump to a channel number.
- Fullscreen: the info panel shows what every button does (follows remote remapping) and each item can be clicked.
- Magic Remote: hover to focus and click to select in every list, the guide grid, settings, menus, the setup screen, the hint bar and the fullscreen legend; wheel scrolls; clicking the preview window goes fullscreen.
- Playback: a channel that fails in one player no longer switches the whole provider to the TV player; each channel tries the built-in demuxer, the TV player and the provider's HLS version once each, then shows a clear message instead of eight reconnects.  Codec details are logged.
- Last channel (Yellow) can be pressed repeatedly; only the channel you stop on starts.
- Navigation: Back always climbs one level (channels, groups, menu bar, then Live); Left from the first column jumps to the menu bar on Live, Settings and Movies/Shows; menu bar tabs are clickable with a pointer; returning to Live restores the column you were in.
- Settings > Groups > Manage groups: every group with a Shown/Hidden switch, plus Show all / Hide all.
- Guide and Live never land on an empty group (an empty Favorites used to show a blank guide); empty groups say so.
- Development log file: with `npm run sim` or `npm run serve`, every log line plus key presses is written to logs/latest.log.  Key handler errors are now logged too.
- Setup: the field being typed in scrolls to the top so the on-screen keyboard no longer covers it.
- Setup: Show/Hide on the password field (Left/Right or click).
- Logs and Test connection describe the username/password shape (length, character types, stray spaces) without revealing them, to catch typos.

## 0.5.0 (2026-10-25)
- New app ID and service ID.  Installs as a new app; uninstall any 0.4.x first.
- Project restructured into a clean repo layout with build/install/inspect scripts.  About screen version now reads from one constant.

## 0.4.2
- http/https auto-detection, portless servers, wrong-scheme fallback, pasted get.php / player_api.php links fill in credentials.
- HTTPS (incl. self-signed) for the TV player and movies routed through the helper.

## 0.4.1
- Diagnostics: step-by-step Test connection, app log and helper log (credentials masked), detailed logging switch.
- Setup screen gets Network (Automatic/Direct), helper status, Test connection and View log.

## 0.4.0
- Bundled network helper service (localhost relay adding CORS headers).  Launch blocker fix: webOS enforces CORS on installed apps.
- Fixes: slow start when live buffer begins after zero; stuck pause after rejected play(); instant TV-player fallback for AC-3; keep playing buffered video when provider hangs up.

## 0.3.0
- Channel name editor rebuilt: per-playlist, preloaded default rules, "Enable recommended defaults", live preview.
- Remote remapping (short/long press, player and list contexts, learn a button, button tester).
- Per-playlist XMLTV sources with priority and offsets, name matching, manual guide assignment, refresh schedules.

## 0.2.0
- Catch-up, Movies/Shows, search, multiview, multiple playlists, favorites, recents, parental PIN, reminders, sleep timer, multi-select.
- Neutral app id (no personal domain).

## 0.1.0
- First build: Xtream + M3U, buffer profiles, stall watchdog, virtual lists, name cleanup, custom groups, hide/restore.
