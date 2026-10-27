TiviBro is built for **webOS 25** and runs on LG TVs from webOS 4 (2018) to webOS 26.  Older TVs get the same features, with a few fallbacks; see [webOS compatibility](https://github.com/ohmybahgosh/TiviBro/blob/main/docs/COMPATIBILITY.md).

## Homebrew Channel (coming soon)

TiviBro will be published as a custom repository for the [webOS Homebrew Channel](https://www.webosbrew.org/), and later submitted to the official store.  The repository address will appear here with the first public release.  Each GitHub release already carries the Homebrew manifest and `repo.json` it needs.

## Developer Mode (works today)

1. Put your TV in [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app), or use a rooted TV.
2. On a computer with Node.js, get the source and build it:

```bash
git clone https://github.com/ohmybahgosh/TiviBro.git
cd TiviBro
npm install                    # installs the webOS CLI (ares-*) locally
npx ares-setup-device          # add your TV (IP, port 9922)
npm run build                  # dist/app.tivibro.tv_<version>_all.ipk
npm run install:tv             # install on the TV
npm run launch
```

Or download the `.ipk` from the latest [release](https://github.com/ohmybahgosh/TiviBro/releases) and install it with `npx ares-install -d <tv> app.tivibro.tv_<version>_all.ipk`.

> Developer Mode sessions expire after a while unless you extend them in the Developer Mode app.  TiviBro keeps working while the session is active.

## Rooted TV: one line

On a rooted TV, one line does it all.  Switch on SSH (or Telnet) in the Homebrew Channel, log in as `root`, and run:

```bash
curl -fsSL https://github.com/ohmybahgosh/TiviBro/releases/latest/download/install.sh | sh
```

It downloads the newest release, checks its SHA-256, installs it and starts TiviBro.  Run it again any time to update; settings are kept.  Options go after `sh -s --`:

```bash
curl -fsSL https://github.com/ohmybahgosh/TiviBro/releases/latest/download/install.sh | sh -s -- --pre              # newest test version (alpha, beta)
curl -fsSL https://github.com/ohmybahgosh/TiviBro/releases/latest/download/install.sh | sh -s -- --tag v0.6.0        # a specific release
curl -fsSL https://github.com/ohmybahgosh/TiviBro/releases/latest/download/install.sh | sh -s -- --ipk /tmp/app.ipk   # an IPK you copied over
```

### Or copy the IPK yourself

On a rooted TV with SSH switched on in the Homebrew Channel (user `root`, port 22), copy the IPK from a [release](https://github.com/ohmybahgosh/TiviBro/releases) to the TV and install it with the TV's own installer:

```bash
scp -O app.tivibro.tv_0.6.0_all.ipk root@TV_IP:/tmp/tivibro.ipk     # -O: the TV's SSH has no SFTP
ssh root@TV_IP
luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/tmp/tivibro.ipk","subscribe":true}'
```

Wait for `"state": "installed"`, press <kbd>Ctrl</kbd>+<kbd>C</kbd>, then `rm /tmp/tivibro.ipk`.  Installing a newer IPK the same way updates TiviBro and keeps your settings.  To start it from the shell: `luna-send-pub -n 1 'luna://com.webos.applicationManager/launch' '{"id":"app.tivibro.tv"}'`.

If `scp` fails, pipe the file instead: `cat app.tivibro.tv_0.6.0_all.ipk | ssh root@TV_IP 'cat > /tmp/tivibro.ipk'`.

## Updating

TiviBro checks for a new release once a day (**Settings > Updates and about**).  On a rooted TV with the Homebrew Channel, **Install** there downloads it, checks it and installs it, and TiviBro restarts on the new version with all your settings.  On other TVs it shows the new version; install it the same way you installed TiviBro.

## Next

[First start](First-start): add your playlist, or restore a backup from another TV.
