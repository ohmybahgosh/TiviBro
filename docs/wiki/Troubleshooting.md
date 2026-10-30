<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

**Settings > Diagnostics > Run connection test** is the best first step when something doesn't work: it checks each part in turn and says what failed.

<p align="center">
  <a href="https://tivibro.app/view/#tv-set-diag-test"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-diag-test.png" width="60%" alt="Connection test"></a>
</p>

<a name="what-is-the-network-helper"></a>**What is the network helper?**  The **network helper** is a part of TiviBro that runs in the background on the TV.  It talks to your provider for the app: it fetches the channel list, the guide and the streams, sends the User-Agent your provider wants, unzips guides, and copes with servers that don't follow the rules.  webOS won't let an app talk to most IPTV servers directly, so TiviBro needs it.  It starts with TiviBro, runs only on the TV, and only ever contacts your own provider (and, if you turn them on, the logo projects).

You'll see it in three places: **Connection** on the first screen and in **Settings > Playback and buffering** (leave it on **Automatic**), **Network helper** in Settings and Diagnostics (it should say *running*), and the connection test.  If it says *not running*, restart TiviBro; if that doesn't help, **Settings > Diagnostics > View network helper log** shows why.

| Problem | Try this |
|---|---|
| A channel won't start or keeps buffering | **OK** on the error message, or **Reconnect** in the quick menu.  Then try **Stream format** HLS instead of MPEG-TS, or a bigger **Buffer profile**. |
| Every channel fails | **Settings > Diagnostics > Run connection test**.  It checks the [network helper](Troubleshooting#what-is-the-network-helper), your login, the channel list, a stream and the guide, step by step. |
| "No guide information" | Check that **Public guide fill-in** is on (Settings > Playlists and guide > the playlist), and that its countries include the channel's.  Then use **Smart match** in the web editor, or **Hold OK > Assign guide** on the TV.  Or add an extra guide source for your region. |
| Guide times are off by an hour | **Provider guide time offset** in Settings, or **Offset** on an extra source in the editor. |
| The guide seems stuck loading | Big XMLTV files take minutes on a TV; watch the progress bar.  If it stays at 0, **Test** the address. |
| The web editor says it can't reach the TV | TiviBro was closed or the TV went to sleep.  Open TiviBro; the editor reconnects and your drafts are safe. |
| Changes don't show on the TV | Check the bar at the bottom of the editor.  If it still counts changes, press **Send to TV**. |
| Wrong editor password | It's on the TV under **Settings > Edit on a phone or computer**.  After five wrong tries, wait a minute. |
| HDR looks grey or washed out | **Settings > Playback and buffering > HDR and Dolby Vision > TV player for all HDR**. |
| A movie plays with no sound | It may only have DTS sound, which 2020 to 2022 LG TVs can't play.  The movie details warn about this; pick another audio track under **Options** if there is one. |
| Dolby Vision shows odd green or purple colours | Make sure **HDR and Dolby Vision** isn't set to *Built-in player*. |
| A remote button does nothing | **Settings > Remote control > Button tester**, then **Learn a button**. |
| Something crashed | TiviBro says so the next time it starts.  **Diagnostics > Report a problem** sends the details to us; **View app log with earlier sessions** shows them on the TV.  Logs mask usernames and passwords. |

---

← [Backup and restore](Backup-and-restore)  ·  [Home](Home)
