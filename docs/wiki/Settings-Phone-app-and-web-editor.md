<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Every setting*

Two different ways to use a phone with TiviBro, on one page.  Each works without the other: the phone app doesn't need the web editor switched on.

- **The TiviBro phone app** (Android) is a remote with the guide, Movies and Shows.  Pair it once with **Pair the TiviBro app…**: that QR code is scanned inside the app, not with the phone's camera.
- **The web editor** works in any browser, for bigger jobs: groups, channels, Smart clean-up, guide matching and backups.  **Open it in a phone's browser (QR code)** is for the phone's camera.  The phone app opens the editor by itself (**Edit channels**), so the switch below is only needed for a browser.

In release builds, where the phone app isn't offered yet, this page is called **Web editor**.

**The web editor**

<p align="center">
  <a href="https://tivibro.app/view/#tv-set-editor"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-editor.png" width="49%" alt="Edit on a phone or computer, off"></a>
  <a href="https://tivibro.app/view/#tv-set-editor-on"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-editor-on.png" width="49%" alt="Edit on a phone or computer, on"></a>
</p>

| Setting | Choices | What it does |
|---|---|---|
| **Open it in a phone's browser (QR code)** | | Turns the editor on and shows the code for your phone's camera, the same as **Edit on phone** in the side menu.  It doesn't pair the TiviBro app. |
| **Web editor for browsers** | On · **Off** | Starts the editor.  It switches off whenever TiviBro closes.  The phone app works either way. |
| **Open this address**, **Password** | (information) | Shown while it runs: the address to open on a device on the same network, and the password to type. |
| **Browsers connected** | (information) | How many browsers are using the editor now. |
| **New password** | | Makes a new password and logs out every browser. |
| **Port** | **8787** · 8080 · 8000 · 9090 · 18787 · 28787 · 38787 · 48787 · 58787 · 61787 · Random high port | Change it if another device on your network already uses this port, or if your network blocks it: the high ones often get through where the common ones don't.  A random port is picked once and kept, so a saved address keeps working. |
| **New random port** | | Only with a random port: picks a different one.  Saved addresses and bookmarks stop working. |

**The TiviBro phone app**

The TiviBro app for Android is a remote and a second screen for this TV.  Pair a phone once and it stays paired.  On each TV in the app:

- **Remote**: arrows round OK (hold OK for options), Back, channel and volume buttons, play and pause, the colour buttons and Info.
- **Type on your phone**: whenever the TV shows a box to type in (setting up a playlist, Search, renaming a group), the same boxes show at the top of the app.  Type with the phone's keyboard and the TV fills in as you go.  Passwords travel encrypted and are never shown on the phone.
- **Channels**: every channel as TiviBro shows it, by group, with what is on now.  Tap one to play it on the TV, and the star to add or remove it from your Favorites.  **Press and hold** a channel for its options: Favorites, your own groups (in or out, or a new group with it), **Rename…** and **Hide on the TV**.
- **Guide**: pick a time (Now, or any hour in the next day and a half) and a group: each channel shows what is on then and what comes after.  Tap a channel for its schedule, day by day, with descriptions: **Watch on TV**, or the bell to set a reminder.  The ▶ on each row plays it on the TV straight away, and **press and hold** gives the same options as in Channels.  Reminders are the TV's own, so they pop up on the TV even while TiviBro is closed.
- **Movies** and **Shows**: the TV's own lists (its languages, hidden categories and PIN) as posters.  Search, pick a category, and open a title: **Resume on TV**, **From the start**, or a show's season and episode.
- **Settings**: every page of TiviBro's Settings on the TV, the same switches and choices, changed on the TV at once.  Buttons (like **Reload channels now**) run on the TV, and a box they open can be typed into from the phone.  When the TV's Settings are locked with a PIN, the phone asks for it.
- **Edit channels**: the [web editor](Turning-on-the-web-editor) full screen, already signed in.
- **Backups** (in the **⋮** menu of each TV): **Back up now**, and a backup every week on its own while TiviBro is open on the TV and the phone is on your Wi-Fi.  Backups stay on the phone, encrypted.  Put one back on this TV or another paired TV, or **Save a copy as a file** with a passphrase, which the web editor's Backup and restore can restore on any TV.
- **Add a playlist from a link**: in your provider's email or message, choose **Share**, then **TiviBro**.  The app says what it found (the password stays hidden), you pick the TV, and the TV checks the login and loads the channels.

The app also turns the TV on (Wake-on-LAN) and has a Quick Settings tile that opens TiviBro on the TV.

To get it: [download the newest APK](https://tivibro.app/apk/) on your phone and open it to install (Android asks to allow installs from your browser the first time, and Google Play Protect checks each update).  Then choose **Pair the TiviBro app…** (it turns on **Phone app connection** if it's off) and scan the code with the app.

| Setting | Choices | What it does |
|---|---|---|
| **Phone app connection** | On · **Off** | Lets paired phones reach this TV on your network, also while TiviBro is closed or another app is on screen.  If webOS stops it, it comes back within 5 minutes, and after an install with the install script it's back right away.  Off: phones can't find or reach it. |
| **Pair the TiviBro app…** | | Turns the connection on if needed and shows a QR code and a 12-character code for the app, for 10 minutes or until a phone pairs.  Five wrong codes end that code. |
| **Paired phones** | | Each phone, when it was added and last seen.  Select one to remove it; it can't connect again until you pair it again. |
| **This TV's name** | | How phones show this TV. |
| **Address** | (information) | This TV's network address and the port the app uses (47810). |

To turn the TV on from the phone, switch on **Turn on via Wi-Fi** in the TV's own settings.

---

← [Settings: Parental controls](Settings-Parental-controls)  ·  [Home](Home)  ·  [Settings: Updates and about](Settings-Updates-and-about) →
