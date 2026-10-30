# TiviMate settings parity

Source: the English UI strings inside TiviMate's APK (`archive/reference/tivimate-ui-strings.txt`, extracted with aapt2 on 2026-10-26).  Only the names of menus and settings were used.  No TiviMate code is in TiviBro.

Legend: **Have** = already in TiviBro.  **Added** = added in this pass.  **Later** = doable, not built yet.  **No** = not possible or not sensible in a webOS web app.

## Playback
| TiviMate | TiviBro |
|---|---|
| Buffer size (Small / Medium / Large / Very large) | Have: buffer profiles plus Custom |
| Turn on last channel on app start | Have |
| Autoplay channels (preview) | Have: Preview in channel list, and the Guide window |
| Display mode (Normal / Full / Zoom / Enlarge / Reduce) | Have: Normal / Stretch / Zoom.  **Added:** per channel, with "Use this size for all channels" |
| Apply to all channels | **Added** (Picture size menu) |
| Video tracks | **Added:** Video quality for HLS streams (Automatic or a fixed resolution) |
| Audio tracks | Have |
| Closed captions / Show closed captions for all channels | **Added:** Subtitles menu, and "Subtitles on automatically" |
| Speed (0.5x to 2x) | **Added:** Playback speed for catch-up and movies |
| Skip step for RW / FF / time bar | Have: Skip step for ◀ ▶.  **Added:** separate ⏪ ⏩ step |
| Use Left / RW to rewind live stream with catch-up | Have.  **Added:** setting to make ◀ go to the last channel instead |
| Use Left/Right, Up/Down, RW/FF for seeking in catch-up | Have: ◀ ▶ skip, ▲ ▼ 5 min.  **Added:** ⏪ ⏩ |
| Show black screen when switching channels | **Added** |
| Show info panel at the bottom when switching channels | **Added** (off shows just number and name) |
| Show media properties / video resolution | **Added:** stream details in the info panel |
| Sleep timer | Have |
| Multiview | Have |
| Restart current program / Watch from start | Have (catch-up channels only) |
| Audio offset | No: browsers can't delay audio against video |
| Audio / video decoder (hardware / software), Tunneled playback, Amlogic fix, Audio passthrough | No: Android player options |
| Auto frame rate, switch refresh rate / resolution | No: LG doesn't let apps change the display mode |
| Picture-in-picture, switch to PiP on Home | No: webOS has no app PiP (Multiview covers watching two) |
| Use external player | No |
| Select surround audio track by default | **Added:** "Prefer surround sound", with "Audio language" and subtitles in one language |
| (not in TiviMate) | **Added:** when a channel stops working, switch to another version of it (other quality, group or hidden copy), or ask, or keep retrying.  "Other versions…" in channel options and the quick menu |

## Guide (EPG)
| TiviMate | TiviBro |
|---|---|
| EPG sources, priority, assign per playlist, time offset | Have |
| Update interval / update on app start | Have |
| Past days to keep EPG | Have |
| Assign EPG to a channel | Have |
| (none) | **Beyond TiviMate:** public guide fill-in for channels with no guide (epg.pw, iptv-epg.org), matched by id, call sign or name |
| Dim past programs | Have |
| Highlight current programs (in color / progress only) | **Added:** Mark what's on now (progress fill / colour / off) |
| Two-line program titles | Have: Two-line programmes |
| Two-line channel names | **Added** |
| Show channel names (logos only) | **Added** |
| Show catch-up icon | **Added** (on/off) |
| Use Back to return to current programs | Have |
| Show TV guide groups | Have: groups panel |
| Full scan / Store program descriptions | No need: the guide is parsed in the background in full |
| Clear EPG | Have: Reload guide now |

## Channels and groups
| TiviMate | TiviBro |
|---|---|
| Channel names editor (prefixes / suffixes) | Have, plus default rule packs |
| Manage groups / Hide all groups / Show all groups | Have |
| Show "Favorites" category | **Added** |
| Show "All channels" category | Have |
| Show newly added groups | **Added:** "Groups your provider adds later: show / hide" |
| Show channels from hidden groups | **Added:** "All channels includes hidden groups" |
| Hide / block channel and group, Manage visibility | Have |
| Copy channels / create group | Have.  The web editor can also copy or move channels into provider groups |
| Channels sorting / Groups sorting | Have |
| Reorder channels manually inside provider groups | **Added:** Hold OK > Move… on the TV, and "Your order" with drag or ⋯ > Move in the web editor |
| Recent channels, count | Have |
| Reset watch time | Have |
| Restore channel name | Have |

## Appearance
| TiviMate | TiviBro |
|---|---|
| Accent / selection color | Have: Electric blue, Cyan, Violet, Mint, Teal, Amber, Ember, Red, White |
| Color theme / background color | **Added:** Midnight (default), Black (OLED), Slate, Classic (1.0) |
| Font size | **Added:** Text size |
| User interface transparency | **Added:** Panels over video (solid / normal / see-through) |
| Clock, show date on clock | Have.  **Added:** date |
| Show channel numbers | Have |
| Panels timeout | Have: Info panel stays for |
| Logos priority (playlist / EPG) | **Added** |
| Logos folder, inexact logo matching | No: no local folders on the TV |
| Animated scrolling / transitions | No: kept off for speed on TV hardware |
| Card style | Later |
| Language | Later |

## Remote control and menus
| TiviMate | TiviBro |
|---|---|
| Remap every button, short and long press | Have |
| Visible / hidden buttons of the player panel | **Added:** Quick menu buttons |
| Reorder buttons | Later |
| Confirm exit by second press Back | Have |
| Long Back to return to the player | Replaced by Play ▶ or a click on the preview window (webOS closes apps on long Back) |

## Reminders
| TiviMate | TiviBro |
|---|---|
| Remind before program start | Have |
| Default action | **Added:** Ask me / Switch to the channel |
| Popup timeout | **Added** |
| Wake up from sleep mode | No |

## Playlists and general
| TiviMate | TiviBro |
|---|---|
| Xtream Codes / M3U, several playlists | Have |
| User-Agent | **Added:** per playlist, sent by the network helper |
| Max connections, expiration date | Have |
| Back up / restore data | Have: full backup locked with a passphrase, made and restored in the web editor (Settings > Edit on a phone or computer) |
| "All playlists" category | Later |
| Stalker Portal | Later (deferred) |
| UDP proxy, SMB, local playlist files | No |
| Recording | No: a TV web app can't write large files.  A server-side DVR covers it |
| Auto start on boot / wake | No |
| Parental controls: PIN, scope, stay unlocked | Have |
