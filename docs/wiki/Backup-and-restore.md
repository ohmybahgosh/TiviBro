<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Web editor: the web editor*

A backup is one file with everything: settings, every playlist **with its login**, each playlist's groups, favorites, names and guide matches, and its restore points.  Channel lists and guides aren't in it; they reload from your provider.

**Always locked.**  You choose a passphrase (or press **Suggest one**).  The TV makes the backup and locks it with AES-256-GCM before it leaves the TV, so the file on your computer is useless without the passphrase.  Nobody can recover a forgotten passphrase, so keep it in a password manager.

**Restoring, even on a brand-new TV:**

1. Install TiviBro and open it.  Choose **Set up or restore from a computer**.  (On a TV already set up: **Settings > Phone app and web editor**.)
2. Open the address shown on the TV and type the password.
3. **Restore a backup**, drop the file, type the passphrase and press **Unlock**.  The editor lists the playlists inside so you know it's the right file.
4. **Restore to the TV.**  TiviBro restarts with everything back, and the editor reconnects by itself.

<p align="center"><a href="https://tivibro.app/view/#tv-restored"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-restored.png" width="60%" alt="The TV right after a restore"></a></p>

<p align="center"><a href="https://tivibro.app/view/#editor-backup"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-backup.png" width="100%" alt="Backup and restore"></a></p>

---

← [Playlists](Playlists)  ·  [Home](Home)  ·  [Troubleshooting](Troubleshooting) →
