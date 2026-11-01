<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Every setting*

Remap any button, choose the quick menu's buttons, and teach TiviBro keys it doesn't know.

<p align="center">
  <a href="https://tivibro.app/view/#tv-set-remote"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-remote.png" width="32%" alt="Remote control"></a>
  <a href="https://tivibro.app/view/#tv-set-remote-player"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-remote-player.png" width="32%" alt="Buttons in the player"></a>
  <a href="https://tivibro.app/view/#tv-set-quick-menu"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-quick-menu.png" width="32%" alt="Quick menu buttons"></a>
</p>

| Setting | What it does |
|---|---|
| **In the player ›** | What each button does while watching live TV fullscreen.  Every button has a press and a **Hold** action.  **OK** opens a list of actions to pick from. |
| **In the guide ›** | The same for the guide: the colour buttons, **Play / Pause**, **Info**, **Stop** and **Hold OK**.  Give any of them **Watch fullscreen** if your remote has no Play button.  Arrows, **OK**, **Back**, **CH + / −** and ⏪ ⏩ stay fixed there. |
| **In the channel list ›** | The same for the Channels screen.  Arrows, **OK**, **Back** and **CH + / −** stay fixed there. |
| **Quick menu buttons ›** | Switch each quick menu button on or off: Channel list, Watch from start, Favorite, TV guide, Other versions, Audio track, Subtitles, Video quality, Picture size, Sleep timer, Stream info, Reconnect.  All are on by default; a button only appears when it applies (Audio needs two or more tracks, for example). |
| **Learn a button** | For keys TiviBro doesn't know yet (some LG remotes have extras).  Press this, then the button; it then appears in the button pages to assign.  Some buttons belong to the TV itself (Home, Live TV, the TV's own Guide, Input, Settings): webOS acts on them before TiviBro hears them, so they leave TiviBro and can't be learned. |
| **Button tester** | Shows the key code the TV sends for the next button you press, and what it does in TiviBro. |
| **Restore default buttons** | Puts every button back the way it came.  Each button page also has **Restore defaults for this screen**. |

The buttons and their defaults:

| Button | In the player | In the guide | In the channel list |
|---|---|---|---|
| **OK** | Quick menu | (fixed: watch) | (fixed) |
| **Hold OK** | Channel list over the video | Options menu | Options menu |
| **▲ ▼** | Previous / next channel | (fixed) | (fixed) |
| **◀** | Rewind (catch-up), else last channel | (fixed) | (fixed) |
| **▶** | Show info panel | (fixed) | (fixed) |
| **CH + / CH −** | Next / previous channel | (fixed) | (fixed) |
| **Red** | Options menu | Options menu | Options menu |
| **Green** | TV guide | Channels screen | TV guide |
| **Yellow** | Last channel | Groups | Last channel |
| **Blue** | Audio track | Settings | Settings |
| **Play / Pause** | Play / pause | Watch fullscreen | Nothing |
| **Stop** | Leave fullscreen | Stop the window | Nothing |
| **⏪ Rewind** | Rewind (catch-up), else last channel | (fixed: earlier) | Nothing |
| **⏩ Fast forward** | Nothing | (fixed: later) | Nothing |
| **Info** | Show info panel | Options menu | Options menu |
| **Back** | (fixed: leaves fullscreen) | (fixed) | (fixed) |

Actions you can give a button in the player: nothing, quick menu, channel list over the video, info panel, options menu, next, previous or last channel, rewind, watch from start, play/pause, TV guide, search, Settings, leave fullscreen, add or remove favorite, open Favorites, open Recent channels, change picture mode, audio track, sleep timer and reconnect.  In the guide: nothing, watch fullscreen (the channel in the window, else the highlighted one), options menu, groups, jump to now, last channel, stop the window, Channels screen, search, Settings, the web editor, favorite, open Favorites or Recent channels, Movies and Shows.  In the channel list: nothing, options menu, last channel, TV guide, search, Settings, favorite, open Favorites, open Recent channels, Movies, Shows and play/pause.  Catch-up and movie playback keep fixed seek buttons so they always behave the same.

---

← [Settings: My media](Settings-My-media)  ·  [Home](Home)  ·  [Settings: Playlists and guide](Settings-Playlists-and-guide) →
