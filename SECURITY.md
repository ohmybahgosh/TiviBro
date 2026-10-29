# Security

## Reporting a problem

Please report security problems **privately**: on GitHub, open the **Security** tab and choose **Report a vulnerability**.  Only the maintainer sees it.  Don't open a public issue.

Helpful to include: what an attacker could do, how to reproduce it, the TiviBro version (Settings > Updates and about), and the TV model and webOS version.  You'll get an answer as soon as possible; fixes go out in the next release, with credit if you'd like it.

## What TiviBro protects

- **Provider logins stay on the TV.**  The web editor only ever sees server names, never usernames, passwords or stream links, and logs mask them.
- **The web editor** is off whenever TiviBro starts, needs the password shown on the TV, locks for a minute after five wrong tries, and only listens on your local network.  Its control endpoints answer only to the TV itself.
- **Backups** are always encrypted (AES-256-GCM with a key from your passphrase) on the TV before they leave it.
- **Releases** list the IPK's SHA-256 in the Homebrew Channel manifest and the release notes; the one-line installer checks it before installing.
- **The logo library** downloads lists of logo addresses per country from tivibro.app and the logos from their own projects.  Nothing from your playlist is sent.

## Supported versions

Fixes go into the newest release only.  Update from the Homebrew Channel or Settings > Updates and about.
