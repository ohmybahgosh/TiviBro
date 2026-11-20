<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*On the TV*

On a rooted TV (the Homebrew Channel) with a USB drive in, TiviBro records to the drive, into a "TiviBro Recordings" folder.  webOS keeps USB drives away from apps installed in developer mode, so recording needs root.

- **Record:** in the guide, Hold OK on a programme > **Record** (on now: until it ends; later: scheduled).  In fullscreen, **OK** opens the quick menu, which starts with **Pause**, **Rewind** and **Record**: that's the way on a Magic Remote, which has no Pause or REC button.  On a remote with **● REC**, that button records too.  A programme being recorded has a red dot in the guide (a ring when it's scheduled).
- **Recordings** (side menu): Recording now, Scheduled, Recorded (a show recorded more than once is one row that opens to its recordings) and Didn't record, with the drive's free space.  OK watches from where you left off; Hold OK or Red: watch from the start, stop, cancel, delete, or select several to delete.  With a TMDB token, recordings get their poster and plot.  Watching one that's still recording, yellow goes to the channel live and Back goes back to Recordings.
- **For Plex, Jellyfin, Kodi and Infuse:** a finished recording moves to **TiviBro Recordings/TV/<show>** (named "Show - s01e02", or by date when the guide has no episode number) or, when TMDB says it's a film, **TiviBro Recordings/Movies/<title (year)>**.  Beside it go a .nfo with its title, plot, year, genre and channel, and TMDB's poster as poster.jpg.  Add the TV and Movies folders to your media server as a TV library and a Movies library.  The Recordings screen shows where each one is.
- **Convert to MP4** (Hold OK or Red on a recording): one .mp4 with its title, plot, year, genre, show, season, episode and channel inside, which Plex, Infuse and Apple TV apps read.  Nothing is re-encoded, so it's quick (a few minutes for a long film) and runs in the background.  A recording in parts becomes one file.  If MP4 can't hold the channel's sound or picture, it's an MKV instead, with the poster inside.  The drive needs as much free room as the recording while it converts.  It plays in TiviBro as before; if you're watching it, the new file waits until you stop.
- **Pause live TV:** Pause keeps the channel (on the USB drive up to 2 hours; without one, up to 10 minutes in the TV's own storage) and Play carries on from there.  ◀ ▶ move back and forth in what's kept, Back goes live, and the info bar says how far behind live you are.
- **Rewind buffer** (off at first): keeps the channel you watch fullscreen on the drive the whole time, so ◀ goes back to something you just missed without pausing first.  Channels take a second or two longer to start.
- Recording and pausing the same channel share one connection to your provider.
- **If TiviBro closes or crashes:** recordings carry on (the recording helper runs on its own, as root), and it's started again within a minute if it stops while a recording is due.  A recording cut short by the TV turning off picks up again when it's back on, if its time isn't over, in a second part that plays on from the first.  A pause or rewind buffer ends with TiviBro: what it kept is deleted within 30 seconds, which also frees its provider connection, and anything left from a crash is cleared the next time.
- Settings > Playback > **Recording and live pause** has the drive, how early to start and how long to keep going after, deleting watched recordings, and the pause settings.

---

← [Catch-up](Catch-up)  ·  [Home](Home)  ·  [Movies and shows](Movies-and-shows) →
