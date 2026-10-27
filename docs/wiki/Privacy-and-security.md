## What stays on your TV

- Your provider logins.  The web editor only ever sees server names, never usernames, passwords or stream links.
- Everything you set up: playlists, groups, favorites, settings.  There are no TiviBro accounts or servers.
- Logs.  They mask usernames and passwords, and only leave the TV if you copy them out yourself.

## The web editor

- Off every time TiviBro starts.  You switch it on under **Settings > Edit on a computer** (or the first-run screen).
- Reachable only on your home network, protected by a random password shown on the TV.
- Locks for a minute after five wrong passwords.
- Every request needs the session it got from the password; nothing is open without it.

## Backups

- Always locked with a passphrase you choose, using PBKDF2-SHA256 (200,000 rounds) and AES-256-GCM.
- The TV makes the backup and the helper locks it before it reaches the browser, so the file on your computer is unreadable without the passphrase.
- The passphrase is never stored or sent to the app.  Nobody can recover a forgotten one, so keep it in a password manager.

## Network

TiviBro only talks to your provider, to guide sources you add, and to your own computer when the web editor is on.  No analytics, no telemetry, no ads.
