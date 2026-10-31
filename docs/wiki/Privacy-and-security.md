## What stays on your TV

- Your provider logins.  The web editor only ever sees server names, never usernames, passwords or stream links.
- Everything you set up: playlists, groups, favorites, settings.  There are no TiviBro accounts or servers.
- Logs.  They mask usernames and passwords, and only leave the TV if you copy them out yourself.

## The web editor

- Off every time TiviBro starts.  You switch it on under **Settings > Edit on a computer** (or the first-run screen).
- Reachable only on your home network, protected by a random password shown on the TV.
- Locks for a minute after five wrong passwords.
- Every request needs the session it got from the password; nothing is open without it.

<p align="center"><a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-editor-on.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-editor-on.png" width="60%" alt="The editor address and password, shown only on the TV"></a></p>

## The phone app

- Off until you switch it on under **Settings > Phone app**.
- A phone pairs only with the code shown on the TV, for 10 minutes.  The code never crosses the network, and five wrong codes end it.
- Each phone gets its own key.  Everything it sends is signed with it, can't be replayed, and the TV signs its answers back.
- Remove a phone in **Settings > Phone app** and its key stops working at once.

## Backups

- Always locked with a passphrase you choose, using PBKDF2-SHA256 (200,000 rounds) and AES-256-GCM.
- The TV makes the backup and the helper locks it before it reaches the browser, so the file on your computer is unreadable without the passphrase.
- The passphrase is never stored or sent to the app.  Nobody can recover a forgotten one, so keep it in a password manager.

<p align="center"><a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-backup.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-backup.png" width="100%" alt="Backup and restore in the web editor"></a></p>

## Network

TiviBro only talks to your provider, to guide sources you add, to your own computer when the web editor is on, and to phones you paired when the phone app connection is on.  No ads.

## Install numbers

Once a day TiviBro tells tivibro.app which version it is and which webOS the TV has, so we know how many TVs run each version.  Nothing else: no address is kept (each network is counted once a day with a hash that is forgotten after two days), no ID, nothing about your channels or playlists.  The install script says whether it installed or updated, and which version.  Switch it off in **Settings > Updates and about > Count this TV in the install numbers**, or run the install script with `TIVIBRO_NO_COUNT=1`.
