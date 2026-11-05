# Changelog

## 0.6.0 (alpha 84, 2026-11-04)

Pre-release: expect rough edges, and keep a backup before installing.

### New in alpha 84

- **One reminder per game for your teams.**  A game carried by several channels got a reminder for each channel's time, plus its "possible Overtime" block and the replays after midnight: five for one Pistons game.  Now the same two teams within 12 hours are one game, with one reminder at its earliest start, and overtime blocks and replays get none.  The extra reminders an earlier version set are cleared on the next start.
- **Reminders on the phone show their channel while the TV is still starting.**  The phone's Reminders screen could say "Channel not in this playlist" for every reminder when the TV was still loading its channels.  The TV now keeps each reminder's channel name, and says "Channels still loading" if it has none yet.
- **The phone's Reminders screen shows the whole time.**  "10:00 PM" lost its "PM" in the narrow time column.

### In alpha 83

- **Subtitles look the way you like** (discussion #19, thanks ich0x).  **Settings > Playback** has **Subtitle colour** (white, yellow, gold, light blue or light green), **Subtitle size** (small to extra large) and **Subtitle background** (outline, a see-through box or a black box behind each line).  They apply to downloads, subtitles in the file and the stream's own.
- **Downloaded subtitles are kept for a week** (discussion #19).  Stop a movie on a work night and finish it at the weekend: its subtitles come back on, with your timing, without using another download.  **Settings > Playback > Keep downloaded subtitles** sets how long, or Off.
- **Film shape in Aspect** (discussion #31).  Any wide film fills the screen, sides cropped: 1.85, 1.90 (IMAX), 2.00, 2.20, 2.39 or 2.76, or type your own, like 64:27.  Remembered per channel, movie or episode like the other shapes.
- **Notices wait until the movie is over** (discussion #35).  A watchlist find while a movie or episode plays full screen shows afterwards ("While you watched: …"), and any notice in full screen now shows near the top, clear of the subtitles.  **Settings > Playback > Hold notices during movies** turns the waiting off.  Reminders you set still come on time.
- **The buffer pill's colours fit the Automatic buffer** (discussion #36).  Green now runs down to half the refill goal, so a steady stream on a small cushion no longer sits in yellow; red is for under a second.  "most 24s" now sits right after the bar.
- **The web editor's sign-in on a phone** (discussion #36).  The **Show** button covered the whole password box on narrow screens; it now sits inside the box's right end.

### In alpha 82

- **MKV subtitles keep up in movies with many languages** (#48, thanks moritzm784).  Only the subtitles you are watching are read from the file, as for MP4 files, so a movie with dozens of subtitle languages no longer shows its lines late or not at all.  A language you switch to is read as you pick it.
- **The subtitle menu keeps its settings at the top** (#49, thanks moritzm784).  **Find subtitles…**, **Timing** and **Line up with another track…** now come first under a **Settings** heading, and the video's own subtitles follow under **In this movie** (or episode, or stream) with how many there are.  The menu opens on the subtitle that is on.  Before, a movie with dozens of languages put Timing at the very bottom.

### In alpha 81

- **Each channel switches between MPEG-TS and HLS by itself, whichever holds up** (#47, thanks ich0x).  A live channel that drops twice in three minutes, or trickles in too slowly to keep up, now switches to its other version straight away, and back again if that one does worse (at most three switches in ten minutes).  A version that doesn't play at all (missing, or no picture within 8 seconds) sends it straight back.  It used to wait for three drops, and a switch on the last reconnect of the budget was overridden: the channel went to the TV's player, then back to MPEG-TS, before HLS was tried.  What worked is remembered for the channel, after a restart too.

### In alpha 80

- **The phone app no longer closes when you open a channel's schedule** (CNN in the guide, on election night).  The guide listed two programmes at the same start time; TiviBro kept one with no time of its own, and the phone's schedule, which lists programmes by start, closed on the repeat.  Programmes with no time of their own are now left out of schedules, search, Movies on now and what's next, on the TV and the phone, and the phone app can't close on a repeated start any more.
- **What's new no longer gets skipped.**  A start that reloaded at once (the TV's helper was slow to answer) marked the new version as seen before the list could show, so the next start skipped it.  It now counts as seen only once it has shown, it waits for a quiet moment (not while a channel is starting or you are pressing buttons), and the list leaves out the release's own heading and the changelog link, on the TV and in the phone app.

### In alpha 79

- **Small TVs stop closing while a channel reconnects** (#42, #46, thanks ich0x).  On a 32-inch LG with little memory, the biggest buffer profiles held a minute of HD video, and a reconnect built a new player while the old one's memory was still being freed: webOS closed TiviBro.  After TiviBro closes while playing, and on any TV that reports 1 GB of memory or less, playback now goes memory-safe for a week: at most 20 seconds read ahead, and a second's pause before a reconnect starts the new player.  Stream info shows "memory-safe" next to the buffer profile, and problem reports say how much memory the TV reports.
- **TiviBro tells you when there's an update, and installs it.**  Each time TiviBro starts it looks for a newer version, and if there is one it shows what's new in it straight away.  On a rooted TV with the Homebrew Channel, **Install and restart** installs it and TiviBro starts again on it; **Later** asks again next time.  Other TVs say where to get it.
- **After an update, a list of what changed.**  The first time a new version starts, on the TV or in the phone app, it shows what's new in it, however it was installed.
- **▲ on the first row goes to the last**, as **▼** on the last already went to the first: in the guide, the group lists, Movies and Shows categories, My media shelves and pop-up menus too.

### In alpha 78

- **Live channels start faster, and learn.**  The new **Automatic** buffer profile (now the default; one picked by hand is kept) learns from each provider as you watch.  It starts like Balanced, then a provider whose channels hardly ever run dry starts channels at 0.8 s instead of 2 s (about a second sooner on a provider without a head start), and a shaky one gets a bigger cushion from the start.  **Settings > Playback > Profile details** shows what it learned.
- **Each channel remembers what it needed, across restarts.**  A channel that only plays as HLS or on the TV's player starts that way at once instead of spending seconds on the others first, and a channel that ran dry keeps the bigger cushion it earned.
- **A stream that trickles in is reconnected before it runs out.**  When video keeps arriving at under half its speed, TiviBro reconnects while there is still a cushion (the last picture stays on screen) instead of playing it down to nothing first.  Stalls and slow patches that catch up are left alone.
- **Faster channel changes after a while away**, since the helper reuses the provider's address while it checks it in the background, and **Stream info** says where a start spent its time: the first data, the first picture, then the buffer.
- **Logos from a busy host fill in.**  Channel logos are often all on one free host, and a guide full of them asked for dozens at once: the host turned most away ("too many requests") and they stayed blank (#45).  The helper now waits as long as the host asks, sends that host's logos one at a time for a minute, and asks for each turned-away logo once more; a logo still missing is tried again a minute later.  Streams are never held back.
- **Buffer settings say what a live channel can really hold** (#44, thanks ich0x).  A live channel only banks what the provider sends ahead of real time, often 10 to 40 seconds, whatever the profile allows.  The profile help and **Read-ahead** now say so, **Profile details** says "holds up to", and buffer info shows the most this channel has reached (*most 34s*).

### In alpha 77

- **Seeing the TV come on over Bluetooth is more reliable.**  An LG TV advertises over Bluetooth in standby too, and counts each change of state in its advertisement.  The app now waits for that count to move on (as it did about ten seconds after a Turn on with the phone's Wi-Fi off) instead of guessing from when it first heard the TV, so a TV the phone hears late is no longer taken for one that just came on.

### In alpha 76

- **App update on the home screen.**  The first TV's card has an **App update** tile next to Remote, Guide and the rest (and a **Check for an app update** button while the TV is off).  It asks GitHub at once: a newer app shows the **Update now** card, otherwise the app says you have the newest one.
- **The phone sees the TV come on over Bluetooth too.**  While **Turn on** wakes the TV, the app (on Android 12 and later) also listens for the TV's own Bluetooth signal, the way LG's ThinQ app does, so with the phone's Wi-Fi off it can still say the TV is on.  Android asks once more for **Nearby devices** to allow it.  The TV's menu on the home screen has a **Bluetooth log** of the last wake, with **Listen for the TV** and **Share**, to look into a TV that doesn't wake.
- **The phone notices the TV as soon as it is back on Wi-Fi.**  After a **Turn on** with the phone's Wi-Fi off (the Bluetooth wake still works), the app said the TV didn't answer and kept showing it as off until its next check.  It now says the wake was sent over Bluetooth and that Wi-Fi is needed to see the TV, and checks every TV the moment the phone is back on Wi-Fi.

### In alpha 75

- **The phone app turns the TV on over Bluetooth too.**  **Turn on** and the Quick Settings tile now also send LG's Bluetooth wake signal, the way LG's ThinQ app does, next to Wake-on-LAN, so a TV that ignores the network wake still comes on.  The app registers itself with the TV by itself while the TV is on, Android 12 and later ask for **Nearby devices** the first time you press **Turn on**, and if Bluetooth is off on the phone the app says so and wakes the TV over the network only.
- **The phone app updates itself.**  When a new TiviBro app is out, **Update now** on the home screen downloads it with a progress bar, checks it is the release GitHub describes, and installs it over this one (Android asks you to allow TiviBro to install apps the first time, and to confirm).  If anything goes wrong, **Download** still opens the APK in the browser.
- **Turn on reaches every network card the TV has.**  The phone app used to send Wake-on-LAN only to the card the TV was using when the app last saw it.  It now learns the TV's Wi-Fi and wired addresses and wakes all of them, as LG's ThinQ app does, so a TV that was on Wi-Fi last time and is wired now (or the other way round) still comes on.

### In alpha 74

- **No more restarts while a big library gets its details.**  Adding a 1,600-movie Dropbox folder made TiviBro grow by about 3 MB a second while it looked up posters and details, until webOS closed it for using 950 MB of the TV's 2 GB.  Every movie's details saved the whole library again, and the TV kept a copy of each save.  Details are now saved together every few seconds, and big saves are sent in a way the TV frees at once: the same lookup now stays flat.

### In alpha 73

- **Dropbox in My media.**  Sign in with the phone app (Settings > My media > Add media > Dropbox), pick a folder, and its movies and TV shows join My media on the TV.  Movies play straight from Dropbox.  The TV keeps only the sign-in, out of backups, logs and problem reports, and removing the source signs it out.

### In alpha 72

- **The audio converter comes with TiviBro.**  No download and no question: the helper unpacks it onto the TV's storage the first time it runs.  The package grows by about 3 MB (both TV builds, with their licences).
- **Converted movies show their picture.**  A converted movie streamed to the TV's own player played sound over a black screen.  It now plays in TiviBro's own player, the way live channels with Dolby Digital do, with the picture copied as it is.
- **Sound and picture start together after a resume or a skip.**  A converted movie started its picture at the nearest full frame before the spot and its sound at the spot itself, so the first second or two was silent.  Both now start at the same frame.
- **Converted movies play through without stopping.**  The converted stream was marked as live, so the TV's own player only ever held a few seconds of it and then stopped asking for more: the picture ran out, TiviBro reconnected and it happened again every few seconds.  It is now sent as an ordinary movie file, which the player reads the whole way through.

### In alpha 71

- **Converted sound keeps playing.**  LG's own player reads a movie in long pulls, hangs up when its buffer is full and later asks for the next part.  The converted stream could only be read from the start, so the picture went black, TiviBro reconnected and the movie began again.  The conversion now runs ahead into a spool on the TV's big storage (at most about half a gigabyte, cleared as the movie goes), and the player gets whatever part it asks for.

### In alpha 70

- **The audio converter is offered when it's needed** (alpha 69 only offered it once, and not at all for a movie whose name didn't give its sound away).  A movie whose sound the TV can't play now asks every time until you choose **Don't ask again**, including when only the file's own tracks show it is DTS or TrueHD: TiviBro reads them as the movie starts, offers the converter, and carries on from the same point with sound.  The "can't play" notice now says where the converter is: **Settings > Playback > Audio and subtitles**.
- **Scans count episodes too.**  After a rescan, My media now says what it found as "3 movies and 24 episodes on Home server" on the TV, in the phone app and in the web editor, instead of only counting movies.  A source set to TV shows only counts episodes.

### In alpha 69

- **Sound the TV can't play is converted.**  LG TVs from 2020 to 2022 (the C1 and C2 among them) can't play DTS, no LG TV plays Dolby TrueHD, and FLAC surround fails, so movies with only that sound played silent.  TiviBro now checks the sound before a movie, episode or My media file starts.  If the file has another audio track the TV plays, in your language, it plays that one.  Otherwise the network helper turns the sound into Dolby Digital (AC-3) while you watch, the picture untouched, and TiviBro says so once.  Seeking starts the conversion again from the new spot, and the time, progress bar, resume point and subtitles keep the movie's own time.  Live channels whose sound the TV can't play are converted too.
- **The audio converter is a small download, only when needed.**  It is a 2 MB build of ffmpeg, made for TiviBro and published on its GitHub releases.  The first movie that needs it asks before downloading.  The helper checks its fingerprint, keeps it on the TV's storage and runs it at low priority so the TV stays responsive.  **Settings > Playback** has **Convert audio the TV can't play** (Automatic or Off), the converter's status, size and where it is kept, and **Get the converter now** or **Remove the converter**.  **What this TV can play** lists which formats get converted on your TV.
- **Watched movies and episodes get a ✓** (thanks to moritzm784, pull request #41).  In **Movies** and **Shows**, a title you watched to the end used to look the same as one you never started, so it was hard to see where you left off.  Now it keeps a ✓ in the list and "Watched" in its details, a show opens on the episode after the last one you watched and its row shows that episode ("S1 E5") with how far you got, **Hold OK** has **Mark as watched** and **Mark unwatched**, and **Resume** on a show plays the episode you're on.

### In alpha 68

- **Favorites only in Favorites, if you like** (thanks to moritzm784, pull request #40).  **Settings > My media > Favorites also in lists** (on by default).  Turn it off and a favorite movie or show is shown only in **Favorites**, not again in **Movies** or **TV shows**.
- **My media opens on the first item on screen** (thanks to moritzm784, pull request #40).  It used to jump straight to the **Movies** shelf, past **Continue watching** and **Favorites**.  It now starts on the top shelf that has something, and stays put once you press a button.
- **Deleted files leave My media** (thanks to moritzm784, pull request #40).  A movie or episode you deleted from your server no longer waits in **Needs review** as a missing file: after a complete rescan it is gone from My media.  TiviBro keeps it out of sight for 30 days in case the server only listed it out for a while (a media server rebuilding its list, a disk that wasn't connected), so a file that comes back keeps its details, favorite and watched state.  A scan that couldn't read every folder, or found nothing at all, changes nothing.

### In alpha 67

- **Restore points and draft history move to the TV's big storage.**  They were kept in the browser's own storage, which on LG TVs sits on the small partition webOS itself uses (720 MB on a C2, two thirds full), and a big playlist's 45 restore points can take many MB.  With the network helper running they now live with the playlists and guide on app storage, and older ones move over the first time they're read.
- **Built-in subtitles keep up when the provider refuses a read** (thanks to moritzm784, pull request #39).  When the provider refuses a subtitle read or the session runs out, the MKV and MP4 subtitle readers now wait together, ask once for a new session (checking it's still the same file) and carry on, also across seeks.

### In alpha 66

- **The TV's screensaver stays away while something plays** (issue #37).  webOS starts its screensaver when no button has been pressed for a while, even over a channel or a movie, and with a homebrew screensaver such as Aerial it showed as a black screen with text over the picture.  TiviBro now asks the TV to wait while live TV, a movie or episode, My media or catch-up plays, loads or buffers, and lets it start when nothing plays, playback is paused, or TiviBro is in the background.  Nothing to switch on, and no extra permissions.  Each time it holds the screensaver off, the log says what was playing.
- **Channels that aren't playing lately are marked** (issue #37).  A channel whose last two tries both failed, while the playlist's other channels play, shows a small amber **not playing lately** tag in the channel lists and the phone app, and **not playing** in the guide's channel column.  The tag goes the moment the channel plays again, and after three days on its own.
- **The last rows of long lists show whole** (discussion #36).  A menu with rows that wrap onto two or three lines, like subtitle search results, starts lower so the focused row is never cut off at the bottom, and leaves out a half row.  The guide's last channels no longer sit under the button hints after its row size was changed in Settings, and a message box always shows its buttons under long text.
- **A steadier buffer pill** (discussion #36).  The buffer meter is now three parts that keep their width: the bar, the picture and engine, and the speed.  Changing numbers no longer push the bar back and forth, and the seconds banked are written inside the bar, light over the empty part and dark over the filled part.
- **Down on the last row goes back to the top.**  In the guide, Down on the last group or the last channel goes round to the first, and so does Down on the last group of the Channels screen (its channel list already did).  Up on the first row stays where it is, as before.  Holding Down still stops at the bottom.
- **No more "TiviBro hit an error" for nothing** (issue #37).  When a channel switched to the TV player, the TS player's worker could throw an error the TV hides the details of ("Script error.").  TiviBro carried on fine, but the next start offered to report it.  Those are now a warning in the log, and a report sent after an error (rather than a close) no longer says TiviBro closed unexpectedly.
- **Subtitles in MP4 movies and episodes** (thanks to moritzm784, pull request #39).  Built-in subtitles in MP4 files from your provider and from My media now show in **Subtitles**, with their language names.  Only the subtitle you turn on is read.
- **Subtitles stay off when you turn them off.**  Choosing **Off** is kept when the player reconnects, even with automatic subtitles on, and a subtitle no longer turns itself on when an MKV or MP4 file's tracks appear.

### In alpha 65

- **A paused movie plays again after a long pause** (issue #34).  When the provider closed the connection during the pause, the movie could refuse to load and even say its format can't be played.  A movie or episode that was playing is now always opened again at the same spot: after a pause of a few minutes it reopens on play, a link that expired meanwhile is asked for again, and the network helper no longer cuts a paused movie's connection after 30 seconds.  If the provider really won't let it back in, the message says so and OK tries again from where you were.
- **Aspect, for pictures with the wrong shape** (discussion #31).  The quick menu's Picture is now **Aspect**: Original, Fill, Zoom, 4:3, 16:9 (for a 16:9 picture squashed into 4:3), 21:9 (a letterboxed 2.35:1 film fills the screen) and 4:3 to 16:9.  Each channel, movie and episode remembers its own, and **Settings > Playback > Aspect** sets the default.  With the TV player some TVs keep the picture as it was, and the menu says so.
- **Subtitle lines no longer get stuck on screen** (discussion #19).  TiviBro now draws downloaded subtitles itself, exactly the lines whose time is now, so a line moved by Timing, Line up or a seek can't stay behind with newer lines drawn over it.
- **Frame rate fix for subtitles.**  **Subtitles > Timing > Frame rate…** scales every line for a subtitle made for a copy at another frame rate (23.976, 24 or 25 fps), for lines that drift further out of time as the film goes on.
- **The phone app keeps working when the TV's clock is off** (issue #32).  A TV whose clock doesn't sync (an app blocking the time server, for example) made the phone app fail with "clock" until it was paired again.  The app now takes the TV's time from its answer and tries again, and the message says what's wrong if it still can't.
- **Update notices that show up** (discussion #33).  TiviBro looked for a new version only once a day, 45 seconds after it started, so a TV that's never switched off rarely heard about one.  It now looks every 6 hours while open, says so once per new version, and **Updates, about and diagnostics** in Settings is marked until you install it.
- **The phone app says when a new version is out** (discussion #33).  The home screen shows a card with **Download** and **What's new** when GitHub has a newer TiviBro app (checked each time the app opens).
- **Typing from the phone, every time.**  A box that opened on the TV right after another change could stay invisible to the phone app (it was told about the screen as it was a moment before).  It now always gets the newest one.

### In alpha 64

- **Settings, cleaned up and the same everywhere.**  The TV, the phone app's Settings tab and the web editor now share one layout and the same names: Playlists, Guide, Channels and groups, Channel and group names, Reminders and watchlist, Playback, My media, Remote and buttons, Appearance and start screen, Parental controls, Backups and restore points, Phone app and web editor, and Updates, about and diagnostics.  Every row's text was checked against what TiviBro does today.
- **The phone app does it on the phone.**  When a setting asks something (a box to type in, a list to pick from, "are you sure"), the question now comes up on the phone instead of on the TV.  The few that need the TV's screen (the button tester, learning a button, the set-up tour, pairing) say so.
- **A new home screen in the phone app.**  Each TV has shortcuts: Remote, Guide, On now, Movies and Shows, My media, Reminders, Edit channels, Backups and Settings.
- **Backups and restore points in one place.**  In the phone app: backups kept on the phone, a locked backup file to save or restore, and the restore points on the TV.  The web editor's two pages are now one, and the TV has its own Backups and restore points section.
- **See your reminders.**  Every reminder still to come, with Cancel and Cancel all: in Settings > Reminders and watchlist on the TV, the phone app's Reminders (also the bell on its Guide tab), and the web editor's Reminders and watchlist page.
- **Channels with no guide.**  A radio stream or a camera never gets a guide: Hold OK > No guide for this channel (or Ignore in the web editor's Guide page) keeps it out of guide matching and stops "No guide information".  Settings > Guide lists them to undo.
- **How your guide is built, explained.**  The Guide settings and the editor's Guide page now say, in order, where programmes come from: your provider, your own sources, the public fill-in (epg.pw, iptv-epg.org and Pluto TV's own guide for Pluto channels), then matching.
- **Group names get their own prefixes and suffixes.**  Channel and group names (was Channel names) has group prefix and suffix lists next to the channel ones, on the TV and in the web editor, and Shorter group names moved there.
- **Web editor tidy-up.**  Tips can be dismissed (Show hidden tips brings them back).  The Clean up your guide steps can each be skipped, fold away when done, and have a collapse button.  Local channels starts with a search for your city.  My media's corrections are now "Fix TV show episodes", with what it is for.  One colour scheme, matching the TV and the phone app.

### In alpha 63

- **Add media from the phone.**  **Settings > My media** in the phone app has its own forms now: **Add media** lists the servers the TV finds on your network, or takes a WebDAV address and login typed on the phone.  Tap a source to rescan it, change what it holds (movies, TV shows or both), fetch its details or remove it, and paste your TMDB token there too.  Logins only travel sealed.
- **Sort TV shows by.**  Next to **Sort movies by** in **Settings > My media** (on the TV, in the phone app and in the web editor): name, first aired or date added.
- **Movies on now by genre.**  Under **On now** and **Starting soon** come the same movies by genre (Action, Comedy, Family…), on the TV and in the phone app's On now tab.
- **No more "My media is for movies only" note.**  Scans only mention the trailers and extras they leave out, as episodes go to TV shows.

### In alpha 62

- **Your playlist logins are private to TiviBro.**  The files where the network helper keeps playlists, movie and show lists and guides were readable by other apps on the TV: their folder is shared into other apps' sandboxes (YouTube, Netflix, the browser and more).  They are now readable by TiviBro only, and files from earlier versions are locked down when TiviBro starts.
- **The guide survives TiviBro updates.**  It was kept in the helper's own folder, which every update replaces, so each update downloaded and read the whole guide again.  It now sits with the playlists on the TV's storage.
- **Storage with the most room.**  TiviBro keeps its data on the TV storage that survives updates and has the most free space (app storage on recent LG TVs, not the smaller user data that webOS needs for itself), and stays there.  **Settings > Diagnostics** and problem reports say where, and how much room is left.  Channel logo lists moved there too, out of the app's small browser storage.

### In alpha 61

- **TV shows in My media** (thanks to moritzm784, pull request #30).  Shows on your own DLNA and WebDAV servers are found next to movies, in flat, nested or mixed folders, and open into seasons and episodes.  With your TMDB token, shows get posters and details on their own, and the seasons you have get episode names, summaries and pictures.  Episodes remember where you stopped and offer the next one, files TiviBro isn't sure about wait in **Needs review** for a quick fix (on the TV or in the web editor, with undo), and a file holding several episodes can use its chapters.  New sources find movies and shows; a source you already have stays movies only until you set its **Content** in Settings > My media.  The library is kept by the network helper in small files, read only when needed, so big libraries fit on older TVs, and it runs on every webOS version from 4 on.
- **Exiting asks first.**  Back to exit (after **Press Back again to exit**) now brings up **Do you want to exit?** and you choose, instead of TiviBro closing at once: the TV's own question on webOS 6 and later, and the same question from TiviBro on older TVs.

### In alpha 60

- **Movies and Shows from M3U links.**  Many providers give one M3U link with their films and series in it.  Those now go to **Movies** and **Shows**, by category, instead of filling the channel list: films as movies, and episodes gathered into shows by season, played from the links in the list.  Search finds them too.  The network helper keeps the library on the TV's storage, so a list with 300,000 titles still fits (issue #26's list: 2,775 channels, 21,946 movies and 7,048 shows).  Reload the channel list once to get them.
- **Guide fallback messages explain what happened.**  When the provider guide fails, TiviBro says it is checking public guides and only says it is using them when matching listings are available.  The TV and web editor keep the original source error for diagnosis.
- **More embedded subtitles in MKV movies.**  Movies with large subtitle indexes no longer lose all their tracks.  ASS/SSA and WebVTT tracks show as plain text alongside SRT.  My media finds MKV subtitles even when a playback link has no file extension.  Track names and newer language tags are read, and Timing also moves the subtitle overlay.
- **One subtitle language at a time.**  The MKV overlay keeps the selected track when another track becomes active, including after skipping backward or forward, preventing languages from stacking.
- **Subtitle text stays readable in more files.**  ASS drawing instructions are left out of plain text, and literal words such as `<Enter>` are kept.
- **Line up survives a seek.**  A subtitle lined up with another track (or moved with **Timing**) stays in time after skipping or a reconnect, including subtitles read from an MKV file as it plays.
- **WebDAV movies can play directly with a login.**  Servers using HTTP Basic authentication work alongside signed file links.  The helper keeps the login out of playback addresses and handles seeking and subtitle reads.  Invalid stream redirects return an error instead of leaving playback waiting.

### In alpha 59

- **A playlist that keeps closing TiviBro is stopped** (issue #25).  If TiviBro closes twice in a row while loading or reloading a playlist, that playlist's **Reload channel list** becomes **Only when I ask**, and the next start says so.  When nothing of the list is kept yet, it asks first: try it again, change the connection, use another playlist or add one, instead of loading it a third time.
- **Stop a load with the remote** (issue #25).  **Back** on the loading screen offers to stop loading a playlist, and **Settings > Playlists and guide > the playlist > Stop reloading** stops a reload and keeps the channels you had.
- **When most of a playlist won't play, TiviBro says so** (issue #25).  Five or more channels failing with errors from the provider (404 Not Found, 522 and the like), and next to none playing, means the list itself is the problem even when the login works and the account is active: out of date, or channels that only work from another country.  It says so once a day, with **Reload the channel list**.
- **Logins hidden in more links** (issues #25 and #26).  The log and problem reports now hide the username and password in the short links many M3U lists use (`http://server/user/pass/12345.ts`), not only in `/live/` links, and the network helper's control key.  The report relay masks them again, and on GitHub every new or edited issue, comment and discussion is checked and masked too, whoever posted it.
- **Huge M3U lists with a film library load on older TVs** (issue #26).  Some M3U lists carry a provider's whole film and series library as entries: one had 2,775 channels and 307,413 movies and episodes (93 MB), which closed TiviBro on a 2020 TV.  In a list of more than 100,000 entries TiviBro now keeps the live channels and leaves the movies and episodes out (it says how many; Movies and Shows come with an Xtream Codes login), and the network helper reads the list with far less memory.  If the helper still can't read a list, TiviBro says it's too big for this TV instead of trying to read it itself and closing.
- **Phone app: editing backups without the TV, easier to start** (discussion #23).  Opening **Edit channels** with the TV now says "channel list saved" once the phone has it (or why it couldn't), each backup says which of its playlists can be edited on the phone, and very big lists (186,000 channels) get through: the editor sends them gzipped, in pieces.

### In alpha 58

- **Content filter** (discussion #20): **Settings > Parental controls > Content filter** takes channels out of everything, the guide, lists, Search, the phone app and the web editor, with no PIN.  **Hide adult channels** knows the usual words in several languages (and leaves "Adult Swim" alone); add your own words and call signs; and **Hide with the content filter** is in a channel's or group's options while watching or in the guide.  A new TV asks on the set-up tour's first screen, before any channels show.
- **Find subtitles for movies and shows** (discussion #19): **Subtitles > Find subtitles…** looks on OpenSubtitles.com for what's playing, in your subtitle languages, with your own free API key.  **Timing** moves a subtitle earlier or later, and **Line up with another track** fixes one that's off by matching it to one in time, frame rate included.
- **Phone app: backups without the TV** (discussion #23): edit a backup's channels in the web editor right on the phone, change settings inside a backup, name, duplicate, merge and delete backups (delete asks twice).  Each makes a new backup to restore on the TV when you're ready.
- **Closed captions on live TV.**  **Captions** in the quick menu (OK in fullscreen) turns them on or off for every channel, like a TV's CC button; also **Settings > Playback and buffering > Closed captions**, with a caption size.  TiviBro reads the CEA-608 captions US channels carry in the video and draws them over the picture in fullscreen, in time with it (pop-on, roll-up and paint-on).  Stream info says whether the channel has any.  Not with the TV player.
- **Guide row size** (Settings > Guide, start screen, reminders): Bigger and Biggest, a little taller rows with bigger names and titles, for smaller TVs or reading from across the room.
- **Bigger movie posters** in the guide's details.
- **The channel guide over the video** is called that everywhere now (it was "Channel list"), and the remote table in the user guide matches what the buttons do.

### In alpha 57

- **TiviBro tells you when the developer answers your problem report.**  Reports sent from the TV or the web editor are opened on GitHub by the report relay, so whoever sent one heard nothing back.  The TV now keeps the reports it sent and asks every few hours (only the report numbers leave the TV).  A reply, or the report being closed, shows once: what the developer wrote, **Update to** the version with the fix when yours is older, a code to read the whole thread on your phone, and **Still happening**, which sends the log as it is now (with a note if you want) and reopens a closed report.  During fullscreen it waits, with a short note, until you're back.  **Settings > Diagnostics > Your problem reports** lists them all with their status, and **Check now** asks straight away.

### In alpha 56

- **Very big playlists don't close TiviBro when they reload** (issues #24 and #25: 186,928 channels on a 2022 32-inch TV).  A reload was the moment memory ran out; it now asks much less of the TV:
  - One reload at a time.  A second (Reload channels while the scheduled reload runs, the web editor) waits for the first instead of downloading and reading the list again.
  - The network helper saves the list it just read as the playlist's copy on the TV, so TiviBro no longer turns hundreds of thousands of channels back into text to save them.
  - The public guide waits until a reload is done, and looks for at most 30,000 channels with no guide (your groups, Favorites, recent channels and shown groups first).
  - The phone app gets at most 30,000 channels of such a list.
  - A playlist over 100,000 channels gets a one-time note on what helps (Reload channel list: Manual, or a smaller list from the provider).
- **Problem reports no longer say "using 10 MB" when the TV doesn't say.**  webOS 22 answers a fixed placeholder for memory; reports now say unknown.
- **The playlist's size shows in the log again** (an M3U read by the network helper said "NaN KB").

### In alpha 55

- **Movies on now stays on the shelf you're on.**  It opened on Starting soon, and Up to On now jumped back down whenever pictures arrived, when a movie was on now and again later.  It now opens on On now and keeps your place.
- **Two programmes at once on a channel no longer mix up.**  When a guide still lists an old schedule next to the new one (FX showed National Treasure 10:00pm to 1:00am and X-Men 10:25pm to 12:55am, X-Men airing), the later start wins: the earlier one ends there.  The details, Movies on now and the grid now agree with what's on.
- **Phone app: movie posters.**  An **On now** tab shows the TV's Movies on now as big posters (On now and Starting soon); a tap opens the movie with its backdrop, title logo, plot and every channel showing it, to watch on the TV or set a reminder (asked first).  Movies in the phone's guide and schedules show their poster and year, genres and rating.

### In alpha 54

- **Movies on now, a screen of its own.**  In the side menu while a TMDB token is saved: big posters of the movies on now and starting in the next three hours, the focused one large over its backdrop with its title logo, its channel, time left and plot.  OK watches it (for one starting later it asks first: remind me, watch the channel now, or Cancel); Hold OK lists every channel showing it.

### In alpha 53

- **Show or hide channels, like TiviMate.**  Hold OK on a channel (or a group) and choose **Show or hide channels…**: the guide (or the channel list) puts a tick on every row, hidden channels too, right where you are.  OK ticks or unticks; Red for Show all, Hide all, Hide channels with no guide information or Leave without saving; Back saves.  The phone app has it too: press and hold a channel.
- **Movies on now, and movie details in the guide (with your TMDB token).**  TiviBro finds the movies in your guide: the guide's Movie category, a year in the title, long programmes on movie channels, and other long programmes TMDB knows well as films.  A movie's details in the guide show its poster, year, runtime, genres and TMDB rating; the grid marks it **Movie**; and a **Movies on now** group lists the movies on now (most left first) and starting within the hour.  Answers are kept 30 days.  The TMDB token can now be added, tested and removed in Settings > Guide, start screen, reminders too.
- **Full themes.**  Settings > Look > Theme sets every colour at once: Black and white, Tokyo Night, Dracula, Nord, Gruvbox, Catppuccin Mocha, Solarized Dark, One Dark, Rosé Pine, Everforest, Kanagawa and Monokai.  Your own mix keeps the background and accent choices.
- **One style for the coloured buttons.**  The hint bar shows every coloured button as a coloured square and what it does, in the same order everywhere (the guide said "Red" in words next to a blue square).

### In alpha 52

- **My teams stays between games and says when the next one is.**  With no game on or within the window, the group no longer disappears from the guide and the channel list: it reads "No games on now or in the next 6 hours.  Next: Detroit Red Wings at Florida Panthers, Tomorrow 7:00pm on NHL | DETROIT RED WINGS."
- **Yesterday's event channels aren't tomorrow's games.**  An event channel named with only a time ("Vikings @ Lions 1:00 PM"), still up hours after the game, no longer counts as a game the next day.
- **Test TMDB token.**  Settings > My media and the web editor can check whether the saved token still works.
- **Movies without details or posters get them on their own.**  With a TMDB token saved, new movies are looked up after each scan and when TiviBro starts, quietly.  One TMDB can't match waits a week; Yellow or Find movie details still tries.
- **No more "Started at …: Next game" questions when TiviBro opens.**  Alpha 51 cleaned up the placeholder reminders that hadn't started yet, but kept the ones whose time had passed while TiviBro was closed, and asked about each of those on opening.  Those go too now, and a placeholder ("Next game: …", "No future events scheduled") is never asked about, whoever set the reminder.

### In alpha 51

- **No more reminders for "games" that aren't.**  An earlier version set My teams reminders for team channels' placeholders ("Future events for Detroit Tigers not found yet", "No future events scheduled") and their "Next game" listings.  TiviBro now removes those from the reminder list when it starts, the TV's helper refuses to show or schedule them even before TiviBro is next opened, and "no future events" style listings never count as games.
- **Reminders know when nobody's watching, on rooted TVs.**  In developer mode the TV refused the helper two questions: is the screen on (or the screensaver / Always Ready), and which app is in front.  So reminders could come up over the screensaver.  On rooted TVs install.sh, or TiviBro itself through the Homebrew Channel, now adds just those two permissions for the helper.
- **Reminder pop-ups with Watch and Dismiss on rooted TVs.**  The TV only takes alerts from LG's own apps, so reminders with TiviBro closed came up as a plain notification.  On a rooted TV the helper now sends the same alert as root through the Homebrew Channel (the programme and channel names go in a file, never on a command line).  Other TVs keep the notification.
- **Phone app: TiviBro log.**  **Settings > TiviBro log** in the phone app shows the TV's log (the app's and the network helper's), the same as Report a problem with provider and server names taken out.  **Problems only** and **Share**.

### In alpha 50

- **Phone app: My media.**  A **My media** tab (once the TV has a source) shows Continue watching, Favorites and All movies as a poster grid with search.  Tap a movie for its details, then **Resume on TV** or **Play on TV**: the TV opens My media and plays it.
- **Pictures of My media** in the user guide, the README and on tivibro.app.

### In alpha 49

- **My media plays your own movies from DLNA / UPnP and WebDAV sources.**  It joins the menu once you add a source in **Settings > My media**.  Browse poster shelves for Continue watching, Favorites and All movies, with the usual movie player, favorites and resume positions.  Source setup stays in Settings and the web editor.  WebDAV playback currently requires a redirect to a playable file link.
- **My media is for movies only for now, and says so.**  Scans leave out TV (season folders and episode files), trailers and extras (Extras and Featurettes folders, "-trailer" files, short clips, much smaller videos next to a movie), and say how many they left out.
- **My media can fetch translated movie details and artwork from TMDB.**  Save your own token on the TV or through the web editor, choose a language, and correct matches from movie options.  Public builds contain no token; media logins and the token stay out of backups and problem reports.
- **Rescan and sort your movie library.**  Green rescans all sources; Yellow fetches missing or outdated movie details.  Sort by name, release date or date added.  Failed, empty or incomplete scans preserve saved entries, and library changes survive restarts.
- **Audio can fall back to a second language.**  In **Settings > Playback and buffering**, choose a preferred audio language and a fallback (off at first).  When neither is there, the stream's own track stays.  Thanks to moritzm784 for My media and this.

### In alpha 48

- **My teams fills in as soon as the guide arrives.**  Right after TiviBro starts, the group was worked out before a big guide had loaded, and kept only the event channels for minutes.  Now it looks again the moment the guide is in, so your team's channel and the local station showing the game appear.
- **At most 8 channels a game in My teams**, your team's channel and the channels in your own groups first (a network game is on dozens of local stations).
- **A college game is no longer taken for your team** when its description only uses nicknames ("the Tigers and the Cardinals").  Replays aren't listed either.

### In alpha 47

- **My teams fixes from the first real game day.**
  - The local station carrying the game is there when you keep it in your own group (**Local channels**) and its provider group is hidden.  Search finds it the same way.
  - Team channels whose guide only says "Next game Mon 7:30pm" are no longer listed as if the game were on.
  - The opponent's own team channel is left out (your team's channel is enough), unless you follow both.
  - Pregame and postgame shows, highlights and the like aren't games.

### In alpha 46

- **My teams only lists games.**  The group has the games on now at the top and the ones starting within **Games starting within** below, soonest first.  A team's own channel is in it only while it shows a game, so "Future events for Detroit Tigers not found yet" or a game tomorrow night no longer puts a channel there.  Shows about one team (a pregame show, a team magazine) aren't games either.
- **Games named only in the description count.**  A local station's "NFL Football" with "Minnesota Vikings at Detroit Lions" in its description is in My teams now.
- **Search looks in descriptions too.**  After the titles, programmes that have what you typed only in their description are listed, with the words around it.  Searching **lions** finds the local station carrying the game.
- **Phone app: Follow a team** from a team channel's long-press options.

### In alpha 45

- **My teams.**  Follow your NFL, NBA, NHL, MLB, WNBA and MLS teams in **Settings > Groups, sorting, hidden > My teams** (or hold OK on a team's channel and choose **Follow**).  A **My teams** group near the top of the guide has their games on now (every channel showing them, together), then their next games, then the teams' own channels from your provider's team groups.  Their games can get reminders too (off at first).  For now the main leagues only: no college, junior, minor league or other countries' teams yet.
- **Remote buttons in the guide can be changed** (**Settings > Remote control > In the guide**).  The colour buttons, Play, Info, Stop and Hold OK each pick an action, including **Watch fullscreen** (the channel in the window, else the highlighted one) for remotes without a Play button.  The defaults are what the guide did before.  The old **In the channel list** page is now just the Channels screen.
- **Events by time is easy to bring back.**  **Settings > Groups, sorting, hidden > Show Events by time** (it was only in the playlist's Event channels page).
- **Learn a button and Button tester say which buttons belong to the TV** (Home, Live TV, the TV's own Guide, Input, Settings).  webOS acts on those before TiviBro hears them, so they leave TiviBro.

### In alpha 44

- **The phone app can reach the TV right after an update.**  Installing a new version stopped TiviBro's helper and removed its restart schedule, so the phone app couldn't reach the TV until TiviBro was opened.  The install script now starts it again straight away, and (with the phone app connection on) adds a 5-minute check that an update from the Homebrew Channel app can't remove.  The helper's own check now runs every 5 minutes instead of 15, so if webOS stops it while another app or the screensaver is on, it's back sooner.

### In alpha 43

- **No more black screen when a channel drops for a moment.**  While a live channel reconnects, its last picture stays on screen with a small notice in the corner, instead of going black with "Tuning".  It goes as soon as the picture is back (or after a long outage), and a new channel never shows the old one's picture.  **Settings > Playback > Keep the picture while reconnecting** turns it off.  Streams the TV player draws itself can't be held and go black as before.
- **A channel that keeps dropping tries HLS sooner.**  Three drops in three minutes on the MPEG-TS stream now switch to the provider's HLS version of that channel straight away (it was only tried after the whole reconnect budget), and TiviBro keeps using it for that channel until it closes.  Errors from the provider itself (outages, connection limits) don't count.
- **Phone app: the Quick Settings tile opens TiviBro again.**  Android let go of the tile as soon as the panel closed, which cancelled the request before it reached the TV.
- **Phone app: the TV's Settings, all of them.**  A new **Settings** tab has every page of TiviBro's Settings (appearance, playback, guide, playlists, groups, remote, parental controls and the rest), built by the TV itself so it always matches.  Changes apply on the TV at once.  Locked with the TV's PIN when its Settings are.
- **Phone app: ▶ on every row of the Guide** plays that channel on the TV without opening its schedule.
- **Phone app: press and hold a channel** (Guide or Channels) for its options: Watch on TV, its schedule, Favorites, your own groups (in or out, or a new group with it), **Rename…** and **Hide on the TV**.  The TV makes the change, the same as from its own menus.
- **Installs are counted.**  The stats page showed 0 installs because only the install script counted them, and most TVs install through the Homebrew Channel or Developer Mode.  TiviBro now counts an install or an update itself the first time a new version starts (version and webOS only, like the daily count, and off with the same switch in Settings, Updates and about).
- **Ideas and feature requests now go to [Discussions > Ideas](https://github.com/ohmybahgosh/TiviBro/discussions/categories/ideas).**  Issues are for bugs and work in progress.

### In alpha 42

- **Big channel lists load with far less memory.**  On a TV, TiviBro's helper now downloads and reads the provider's channel list (Xtream Codes or M3U) and hands TiviBro just the channels, using the same code, so every edit still fits.  With a 180,000-channel list, TiviBro used about 89 MB right after starting, where it used 268 MB before.
- **One settings page for the phone app and the web editor.**  **Settings > Phone app and web editor** says which is which: **Pair the TiviBro app…** (scanned inside the app; it turns the connection on if needed) and **Open it in a phone's browser (QR code)** for the web editor.  The phone app works without the web editor switched on.
- **The Channels list is out of the side menu unless you want it.**  Turn it on with **Settings > Guide, start screen, reminders > Channels list in the menu**.  **Green** in the guide still opens it, and it stays while TiviBro starts on it.
- **Move a channel from the guide.**  Hold OK on a channel in the guide and choose **Move…**, then ▲ ▼ (CH +/− for a page) and OK.  The new order is saved the same as moving it in the channel list.
- **The guide's group list keeps the highlight on screen.**  Going down past the last group that fit, the highlight disappeared below the panel; the list now counts the rows that really fit.
- **Matched, but the guide is empty, now says so.**  In the web editor's step 4, a channel matched to a guide channel that has nothing scheduled goes under a new **Guide is empty** tab, marked "matched, nothing scheduled" with **Find another…**, instead of looking unmatched under **Needs a guide**.  Smart match no longer suggests guide channels with nothing scheduled.
- **Matching no longer silently does nothing on some providers.**  Some provider guides list channels with a blank id (550 on one provider tested), which can never have programmes.  Smart match offered them as 100% matches, and approving one left the channel unmatched.  They're left out now.
- **Phone app: groups that were empty in the Guide and Channels tabs** (for example a **Local channels** group whose network groups are hidden) now list their channels.
- **Phone app: Movies and Shows tabs only show when the provider has movies or shows.**
- **Phone app: Back goes back one step.**  In the web editor it closes what's open, then goes back through the pages you visited; on the Channels, Guide, Movies and Shows tabs it returns to the remote, before leaving the TV.
- **Web editor: the "Show unsure guesses" box in Smart match** sits on its own line.
- **Big playlists live on the TV's storage, not the browser's** (follow-up to [#18](https://github.com/ohmybahgosh/TiviBro/issues/18)).  Older TVs give TiviBro only a small share of their storage, so a big channel list or movie library didn't fit and was downloaded again every time.  The channel list and the full movie and show lists are now kept by TiviBro's helper on the TV itself, which also does the language and category filtering, so TiviBro holds only what you see.  Changing languages in Movies and Shows no longer downloads anything.

### In alpha 41

- **Numbers that stay put** ([#17](https://github.com/ohmybahgosh/TiviBro/issues/17)).  The buffer info no longer grows and shrinks as its seconds change.  **Settings > Appearance > Numbers** can give every digit the same width (**Even width**), so channel numbers and times line up, or a fixed-width style with a slashed zero.
- **No more Movies and Shows crash on older TVs with big lists** ([#18](https://github.com/ohmybahgosh/TiviBro/issues/18)).  Changing the language filter or a category while the list was still loading could stop Movies and Shows from working; the list now stays on screen and is re-sorted from memory.  When a TV runs out of storage saving a big playlist, TiviBro frees the cached lists of your other playlists and tries again, so it no longer downloads everything again each time it starts.

### In alpha 40

- **Empty event slots count as nothing on.**  **Hide channels with nothing on** now also catches slots with no event in them ("PPV 09 |", "EPL 02:", " :ESPN+ 291") and events that ended hours ago that the provider never renamed.  They come back by themselves when a new event is named.
- **Old events say so.**  An event channel whose game is long over shows "Ended Feb 8: …" in the guide, instead of looking live or empty.  The web editor's Smart clean-up has a new step, **Groups of old events**, for groups where every event ended days ago (a Winter Olympics group in November).
- **Team channels show the game.**  Guides that only say "Next game: Blackhawks at Bruins at 10/31 01:00 PM EDT" in long overlapping blocks now show "Next game Sat 1:00 PM: Blackhawks at Bruins" until the game, then the game at its time, without duplicates.
- **Pluto TV channels get a guide.**  Pluto channels with no guide from the provider are filled from Pluto's own guide (i.mjh.nz), matched exactly by channel id, with the other public guides.  Turn it off with the public guide under **Settings > Playlists > the playlist > Guide**.
- **Guide ids that point nowhere are ignored.**  Placeholder ids ("0") and one id given to many unrelated channels no longer tie those channels to the wrong guide or none; they get their guide by name or from the public guides instead.
- **When your subscription ends, first on each playlist** ([#13](https://github.com/ohmybahgosh/TiviBro/issues/13)).  **Settings > Playlists** and the web editor's Playlists page lead with it ("Expires 19 Nov", "Expires in 3 days", "Expired 2 Oct"), for every playlist, not only the one in use.  Xtream Codes providers say when; M3U playlists don't.
- **Browsers offer to save the web editor's password** ([#15](https://github.com/ohmybahgosh/TiviBro/issues/15)).  The login box is a real password field now (Firefox, Chrome and Safari offer to remember it), with **Show** to check what you typed.

### In alpha 39

- **Big playlists stay responsive while you edit** ([#14](https://github.com/ohmybahgosh/TiviBro/issues/14)).  With a very large playlist (100,000 channels or more), the TV no longer sends the whole channel list to the web editor again after every change, so the remote and the phone app keep working while changes are applied.  The phone app says when TiviBro on the TV is busy.
- **The phone app does a lot more** (TiviBro for Android).  On each TV: a **Guide** made for a phone (pick a time and a group, tap a channel for its schedule with descriptions, **Watch on TV** or set a reminder the TV keeps); **Movies** and **Shows** as posters with search, categories, details, resume and episodes, all played on the TV; a star on every channel for **Favorites**; and **Type on your phone** into any box the TV shows (setting up a playlist, Search, renaming), passwords included, sent encrypted.
- **Share your provider's link to TiviBro.**  In the email or message from your provider, choose Share, then TiviBro: the app shows what it found and the TV adds the playlist.  On a brand-new TV this is the whole set-up.
- **Backups on your phone.**  **Back up now**, or once a week on its own while TiviBro is open and the phone is on your Wi-Fi.  Restore on this TV or another, or save a copy the web editor can restore with a passphrase.  Logins and backups travel between the phone and the TV encrypted.
- **Buffer info on every remote.**  **Stream info** in the quick menu (**OK** in fullscreen) now shows the buffer gauge too, and its numbers update while it's open, so Magic Remotes without an Info button can see it.  Any button can open it: **Stream info and buffer** under **Settings > Remote control**.  When TiviBro has only seen a Magic Remote, its hints stop pointing at the Info button.
- **A bigger set-up banner** ([#8](https://github.com/ohmybahgosh/TiviBro/issues/8)).  What your phone or computer is doing during set-up now shows in a large banner along the bottom of the TV, easy to read on a small screen or from across the room: green when a playlist was added, red with the reason when it didn't work.  Any button on the TV remote clears it.

### In alpha 38

- **Paste your provider's full link** ([#11](https://github.com/ohmybahgosh/TiviBro/issues/11)).  Adding a playlist on the TV or in the web editor now starts on **Full link**: paste the whole link your provider sent (get.php, player_api.php, xmltv.php or a stream link with the username and password in it) and TiviBro says what it found, then fills in the Xtream Codes server, username and password.  A link without a login is added as an M3U playlist.  The Xtream Codes and M3U choices are still there for typing it in yourself.

### In alpha 37

- **The TV shows what your phone is doing during set-up** ([#8](https://github.com/ohmybahgosh/TiviBro/issues/8)).  On the QR code screens, a line says when a playlist or backup arrives from a phone or computer, when it was added (with the channel count), and when it failed and why, so whoever is at the TV sees it working.  Nothing starts playing by itself.
- **Codes you can't misread** ([#10](https://github.com/ohmybahgosh/TiviBro/issues/10)).  New web editor passwords, phone pairing codes and suggested backup passphrases leave out characters that look alike from across the room (2/Z, 5/S, 6/G, 8/B and U/V, on top of 0/O and 1/I/L).  Typing a look-alike still works, so a 5 for an S in an older password is accepted.

### In alpha 36

- **High ports for the web editor** ([#7](https://github.com/ohmybahgosh/TiviBro/issues/7)).  For networks that block the usual ports, **Settings > Edit on a phone or computer > Port** adds 18787, 28787, 38787, 48787, 58787 and 61787, and a random high port that stays the same until you choose **New random port**.
- **Buffer info on demand** ([#6](https://github.com/ohmybahgosh/TiviBro/issues/6)).  Hold **Info** in fullscreen to show the buffer meter, with the seconds banked and the stream's speed when the player reports it, even with the meter set to Off.  It hides itself after 10 seconds (5, 30 or until pressed again in Settings > Playback), and pressing again hides it.  Any button can do it: **Show buffer info** under Remote control.

### In alpha 35

- **Embedded MKV subtitles.**  Movies and episodes with indexed SRT subtitles now show their tracks in the subtitle menu, including on older LG TVs.  Playback and subtitle reads share one provider session to avoid reconnect loops, and subtitle selection survives seeking and reconnects.

### In alpha 34

- **Shorter release notes.**  Each release page lists only what's new in that build, one line per change, with a link to the full changelog; install steps fold away.  Before, every test build repeated the whole 0.6.0 history.
- **Search puts the best match first, movies and shows included.**  Results are ranked by how closely the title matches (the whole title, then the start, then a word), and then by what you can watch: on now, a movie or show, a channel, coming up, a replay.  Searching batman now lists the Batman films before the 24/7 Batman channels, and CNN still finds the channel first.  Before, movies and shows came after every channel and programme.

### In alpha 33

- **Movies and Shows by language, and lighter on the TV.**  Many providers put a language code in front of every title ("SE - ", "EN - ", "[SE]") or on the category ("|TR| DIZI").  TiviBro now takes it off the name, and a **Languages** row at the top of Movies and Shows picks which languages show.  By default that's your TV's language plus titles with no tag; a library with one language shows everything.  A 4K tag becomes a 4K label.  Hold OK (or Red) on a category to hide it, its titles leave All and Search too.  Only what shows is kept in memory, and on the TV the helper now downloads and slims the provider's list, so a 160,000-title library no longer has to be parsed by the app itself.
- **Adult categories stay out of the way.**  Movie and show categories named for adults (Adults, XXX, 18+) are listed last, and their titles stay out of All movies, All shows and Search.  With a PIN for blocked channels, they ask for it.

### In alpha 32

- **Movies and Shows, checked against a provider with 54,000 movies and 13,000 shows.**  Details (plot, cast, director) now show for the first title of every list, not only after moving.  Running times read 1 h 25 min instead of 01:25:00, empty 00:00:00 times are hidden, and ratings show one decimal (★ 7.6, not ★ 7.634).  Coming back from a movie keeps you in the same category when Continue watching appears.
- **Install numbers, anonymous.**  Once a day TiviBro says which version it is and which webOS the TV has (nothing else: no address kept, no ID, nothing about channels), and the install script says whether it installed or updated.  Off in **Settings > Updates and about > Count this TV in the install numbers**, or with `TIVIBRO_NO_COUNT=1` for the script.
- **A privacy page** at [tivibro.app/privacy](https://tivibro.app/privacy/), linked from the site's footer, lists everything the TV app, the phone app and the site send.  The Privacy and security guide now names every server TiviBro talks to.

### In alpha 31

- **The phone as a remote, and Play on TV** (TiviBro for Android, the APK is attached to this release, with Settings > Phone app on the TV).  **Remote and channels** on a TV: what is playing now, with the programme and its progress, kept up to date as the TV changes; a remote (arrows round OK, hold OK for options, Back, Channels, Guide, Channel up and down, play and pause, rewind and fast forward, the colour buttons, Info, and the TV's own volume and mute); typing a search on the phone searches on the TV; and **Channels**: every channel as TiviBro shows it, by group, with what is on now, searchable, and a tap plays it on the TV.  A button with TiviBro closed opens it first.

### In alpha 30

- **Search shows why a channel matched.**  Providers often write the game into the channel name ("BIG10 10: Michigan vs Ohio State"), while TiviBro shows the short name ("BigTen 10"), so searching "michigan" listed a column of BigTen channels with nothing about Michigan.  Those results now show the game as the title with the channel under it ("in the name"), or as an upcoming or on-now event with its time when the name has one, sorted by time.  And a channel with no guide shows what its name says in the channel details and the player bar, instead of just "No guide information".
- **Settings pages update by themselves.**  **Reload guide now** used to leave **Guide last loaded** at the old time until you left the page; it now says "loading now", then the new time.  The same goes for **Last reloaded** after **Reload channels now**, each guide source's result, **Channels with guide data**, and the public guide's last look.
- **The start-up screen shows the full TiviBro logo** instead of the "tvb" initials.
- **Phone app connection, ready for the TiviBro app for Android (test builds only for now).**  New in **Settings > Phone app**: switch it on, then **Pair a phone** shows a QR code and a 12-character code for ten minutes.  Paired phones are listed (when added, last seen) and can be removed, and you can name the TV.  While on, the helper keeps a small server running on your network (port 47810), also when TiviBro is closed, so a phone can find the TV, open TiviBro, and open the web editor already signed in (TiviBro starts the editor by itself when a phone asks).  After the TV restarts it is back within 15 minutes.  The pairing code never crosses the network, five wrong codes end it, each phone gets its own key, and every request and answer is signed and can't be replayed.  The protocol is in the wiki (Phone app protocol), with a reference client in scripts/companion/tb-phone.js.  The app itself comes next.
- **The TiviBro app for Android, first version** (android/, the APK is attached to this release): pair by scanning the TV's code (or pick the TV found on your network and type the code), see each TV (on, TiviBro open), **Edit channels** opens the web editor full screen and signed in (backups and restores work from the phone), **Open TiviBro**, **Turn on** (Wake-on-LAN), and a Quick Settings tile that turns the TV on and opens TiviBro.  Keys are kept in the Android Keystore and out of backups.  CI tests it against the TV's real helper code and builds the APK.
- Only TiviBro can switch the web editor and the phone app connection on or off: the helper now gives TiviBro a secret when it starts, so a web page in the TV's browser can't reach them over localhost.
- **Special thanks** in the README and on tivibro.app: everyone whose pull request was merged or who sent an idea or a bug report, kept up to date by itself (scripts/gen-thanks.js and the Thanks workflow).
- Every screenshot, GIF and video re-recorded from the current app, the search video now finds a movie too, and tivibro.app's pictures follow (scripts/demo/site-shots.sh, scripts/demo/phone-shots.js).

### In alpha 29

- **TiviBro notices when it closed by itself, and asks to report it.**  webOS ends an app that runs out of memory without any error, so the old "hit an error" notice never showed (the alpha 24 guide loop said nothing).  TiviBro now keeps a note of what it is doing (loading which guide and how far, playing which channel, its memory use); if a session ends with that note still open, the next start asks right away and says what it was doing: **Send a report now** sends it straight from the TV (no phone, so it works even when TiviBro keeps closing), **Report with my phone** adds details, or **Not now**.  The report and the log carry it.  The TV turning off or restarting, and updates, don't count (the network helper says when the TV started and when it went to standby), and the helper keeps its own errors on the TV so a report made after it restarted still has them.  Warnings and errors are saved at once instead of a moment later, so the last lines before a close are kept.  Test builds have **Report a problem** at the bottom of the menu.

### In alpha 28

- **The public guide reads iptv-epg.org again.**  The site now answers its files with a redirect to a new address, which the helper's guide reader didn't follow, so iptv-epg.org quietly added nothing.  Redirects are followed now, and an answer that isn't the guide counts as a failed file.
- **Older TVs (webOS 6 and earlier): the preview window has square corners.**  Those TVs show video on a layer behind the page, and the rounded clip around the preview can leave it black (reported on a 2019 C9).  Newer TVs keep the rounded corners.
- **A sleeker LIVE chip** in the programme details: your accent colour with a small dot, instead of a red that looked like a warning.

### In alpha 27

- **Search now finds Movies and Shows.**  A new **Movies & Shows** filter sits beside Everything, On now, Coming up, Replays and Channels.  No need to open Movies or Shows first: the lists load in the background when Search opens, and titles that start with what you typed come first.  **OK** opens the movie in Movies and plays it, or a show's episodes, same as picking it from the list.  Thanks to moritzm784 for the idea and the code (#2, #3).
- **The guide looks more like TiviMate.**  Rows have more room.  What's on now has the part already aired tinted in your accent colour, under the text, instead of a bar; the time line is a thin line in the accent colour with a marker in the time bar; and the programme details show a short bar with the time left, as in TiviMate.
- **The web editor's guide Test connection gives up after 20 seconds** on a server that accepts the connection and then goes silent, instead of spinning forever.  Thanks to moritzm784 (#4).

### In alpha 26

- **Reorder groups from a phone.**  In the web editor, **⋯** on a group has Move to the top, Move up one, Move down one, Move to the bottom and Move to position…, like channels.  Phones and tablets can't drag, so the drag handle is hidden there.
- **Big guides of any size, with days of programmes.**  The network helper now downloads and reads XMLTV guides and keeps them on the TV's storage; TiviBro itself holds only programme times and titles and fetches a channel's descriptions when it shows them.  A 300 MB test guide (4,000 channels, 3 days) loads in seconds with TiviBro using about 110 MB, where a 64 MB guide used to close it.  A restart shows the guide from storage without downloading again, and the guide now reaches three days ahead.  TVs without the helper keep reading the guide in the app, within its memory limit.
- **Short shows are readable in the guide.**  A programme with only a few minutes left at the guide's start (or a short filler) was a sliver with its title cut to "J…"; it now borrows width from the next programme so the title fits.
- **A sleeker "on now" in the guide.**  The red time line no longer runs across programme titles: it sits behind the programmes, with a small marker in the time bar.  What's on now gets a slim progress bar under its times instead of a shaded block.  **Colour** keeps the coloured cell and adds the bar.

### In alpha 25

- **A guide too big for the TV no longer closes TiviBro over and over.**  On a 2 GB TV, a 64 MB extra guide (iptv-epg.org, all of the US) on top of the provider's ran the app out of memory, and because the load started again on every launch, TiviBro kept closing.  Now a guide load keeps to a memory budget (descriptions get shorter, then extra channels are left out, with a notice saying so).  If the app still closes during a load, the next start tries once more with half the memory; after a second time, guide loading pauses with a notice naming the guide it was loading, until you remove it and press **Reload guide now**.
- **Smart match applies what you approve.**  On a short list the matching finished before the dialog was ready and left **Apply** greyed out, so nothing was applied and the channels stayed under "Needs a guide".  Approving is also clearer: rows say **✓ Approved** in solid green, tapping ✓ again no longer quietly un-approves a row (✕ skips it), and Apply says "Nothing approved yet" when that's the case.
- **Smart match on phones:** each row stacks the channel, the guide channel, then the confidence and Approve, so nothing hides off the right edge.
- **Smart match no longer suggests a channel's own empty guide.**  Channels whose guide id has no programmes are looked at too; suggesting that same id again changed nothing.
- **Guide download progress when the server gives no size:** the TV remembers each guide file's size from its last download and shows "12 MB of about 64 MB" next time.  (Only a fingerprint of the address is kept, never the address with its login.)

### In alpha 24

- **Multiview is gone.**  webOS lets an app play only one video at a time (LG says so for web apps), so a second screen always stopped the first on real TVs.  It is taken out of the app, the quick menu, settings, the docs and the site rather than left half working.  Blue in the player now opens the audio track; a button you had set to multiview does the same.
- **Every step opens on what's in effect now.**  Run again, the TV's set-up tour starts from your current setup (the countries shown, the feed you kept, the cities in your local group, hidden dividers and empty groups) and says so.  In the web editor, Smart clean-up steps re-read the current state after each change, undo, redo or reload: country chips show what is shown ("Shown now: ..."), East and West says which feed is kept, Local channels ticks your current cities, and Adult groups, Shorter group names and Divider groups list what they hid with **Show them again** or **Put it back**.
- **Holding OK no longer jumps to fullscreen.**  Holding OK on a channel opened its menu, and the TV's key repeats while OK was still down then picked the menu's first item.  Repeats now belong to the hold until OK is let go.
- **Settings scroll to the end.**  Notes under the last choice (like the reminder list below "Reminder question stays for") were cut off under the button hints; now the last choice brings them into view.  Pages of facts only (Diagnostics > What this TV can play) scroll with ▲ ▼ and no longer show a heading as selected, and the top row no longer covers the clock.
- **The guide's groups panel reads as a layer:** its own raised colour and accent edge, with the programmes behind it dimmed.
- **Web editor, Smart clean-up as a checklist:** each step says Done, To do or Skipped, with **Skip** and a count at the top, and the menu badge counts the steps still to do.  New steps: **Adult groups** (Adult, XXX, 18+, not Adult Swim) and **Shorter group names** (take "USA" off "USA News", "USA Sports"...).  Countries get **Tick all** and **Untick all**.
- **Duplicates make sense:** each copy says **Keep** or **Hide** (no more "unmarked"), **Keep all** skips a set, and channels with different numbers ("US (Peacock 002)", "US (Peacock 014)") are no longer taken for copies.
- **Local channels:** stations with no city (Galavision, UniMás and other national feeds) no longer land in your "Local channels" group, a city in brackets counts ("CW | EAST (PHILLY)"), and coming back shows your earlier pick ticked.
- **Start over** (Changes and restore points) resets the playlist to how the provider sends it, undoable, like the TV's Clear all edits.  The changes page offers **Undo the undo** after going back, and "yours" became "Saved by you".
- **Guide page:** jump links to each step, the match list scrolls in its own box, and the **Watchlist** has its own page.  Guide sources show the free guide's name and size, or the server and file name (never a login), and recommended guides you added show **✓ Added** and **Remove**; a stale "added" message no longer stays after removing one.  Smart match says how many guesses were left unapproved.
- The backup card explains Chrome's "can't be downloaded securely" warning (the editor comes from the TV over your home network) and that **Keep** is safe: the file is locked with your passphrase.
- **On a phone:** dropdowns (like "All shown channels") no longer close as the keyboard comes up, and the menu button says **Menu** and pulses until first opened.  The checklist ticks **Download a backup** once one is made (it remembers when).
### In alpha 23

- **Fixed: full XMLTV guides and the public guide failed on the TV** ("S is not defined", "pubKeys is not defined").  The release build is minified, which renamed the guide reader's name matching and dropped the markers it was wired in by, so name matching for added guides and the provider's full guide, and the whole public guide fill-in, failed on real TVs while every test of the source passed.  The guide reader now gets those helpers in a way minifying can't break, a failed guide file stops downloading instead of showing as still running, and `scripts/test-build.sh` runs the guide tests against the minified build.
- The rooted-TV installer now really starts TiviBro when run the usual way (`curl -fsSL https://tivibro.app/install | sh`).  Run like that, the script arrives on the TV's input, and the TV's `luna-send` answered nothing at all, so alpha 22's installer said it couldn't start the app.  Its TV calls now take their input from `/dev/null`, and a test runs the installer piped, as people do.

### In alpha 22

- The rooted-TV installer (`curl -fsSL https://tivibro.app/install | sh`) starts TiviBro again on webOS 25, where the TV refuses app launches over `luna-send-pub`: it now uses the private bus as root.  It also shows the version that was installed before, which was missing for the same reason, and says so plainly when the TV won't start the app instead of claiming it did.

### In alpha 21

- Reminders also wait while **LG Gallery+** or **Line View** is on screen (found on a real 2022 C2 on webOS 25, where they are called `com.webos.app.lifeonscreen` and `com.webos.app.atelier`), as they already did for the screensaver, homebrew screensavers such as Aerial, and Always Ready.

### In alpha 20

- **A guide for channels your provider leaves blank.**  After your guide sources and your provider's guide load, TiviBro looks up the channels that still have nothing in two free, community-run guides: epg.pw (20 countries, lighter files, tried first) and iptv-epg.org (70 countries, bigger and more complete).  Channels match by guide id, a US local station's call sign ("ABC (WXYZ) Detroit", "WXYZ-DT") or the name, East and West feeds kept apart, and only in their own country's guide when the country is known.  It never replaces a guide you have.  On by default; Settings > Playlists and guide > the playlist > **Public guide fill-in** turns it off, picks countries (automatic, or up to eight) and shows how many channels each guide filled in.  The TV downloads the files itself, at most twice a day, after your own guide is on screen, and keeps them; a file is skipped when every channel it could match is already filled in.  Programmes from it say "public guide", its channels can be picked in **Assign guide** and Smart match, guide search and the watchlist see them, and the web editor's Guide page has a card for it.  The set-up tour has a Guide step, and the connection test checks the public guides can be reached.  On a real playlist of 7,000 channels with no provider guide, the US files filled in 1,800 channels in about 10 seconds on a computer.
- **Hidden, not gone: said where it matters.**  The set-up tour, Smart clean-up, the user guide, the README and tivibro.app now say plainly that the extra copies you hide are still backups (when the copy you keep stops working, TiviBro switches to one by itself), that the other East or West feed is not a backup, that hiding the network groups keeps your stations in Local channels, and that hidden groups leave the guide, All channels and Search but are never deleted.  The tour shows these as short notes under the choice they explain, and its summary says "Full HD shown, the rest kept as backups".
- **Screenshots open large from GitHub.**  Pictures in the README and the user guide open in a viewer on tivibro.app (tivibro.app/view): full size, ← → or swipe through the rest, click to zoom to 100%, and Back returns to GitHub.
- The website's FAQ answers "If I hide the other qualities of a channel, can TiviBro still switch to them?".

### In alpha 19

- **New icon.**  A full navy square with a soft blue glow and a bigger glossy V, so TiviBro stands out in the TV's app list and the Homebrew Channel instead of a near-black tile.  The website and web editor icons match.

### In alpha 18

- **Reminders only for someone using the TV.**  When the screensaver, the Gallery or art screen, Always Ready or a dark screen is up, the TV's reminder alert waits instead of popping up over it, and looks again every couple of minutes while the programme is on; once someone is back on another app or input, it shows (saying when it started).  Inside TiviBro, a reminder waits when nobody has touched the remote for 10 minutes and nothing is playing, and the next press brings it, with **Watch from the start** on catch-up channels.  The helper log records what was on screen each time, for TVs that name their screensaver differently.

### In alpha 17

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

### In alpha 16

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
