TiviBro runs on LG TVs with webOS 6 or newer.

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

## Next

[First start](First-start): add your playlist, or restore a backup from another TV.
