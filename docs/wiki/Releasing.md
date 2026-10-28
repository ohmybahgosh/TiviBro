Releases are built by GitHub Actions.  Every push and pull request also runs lint, tests and a test build.

1. `bash scripts/bump-version.sh X.Y.Z`
2. In `CHANGELOG.md`, rename `## Unreleased` to `## X.Y.Z (date)`, then commit.
3. `npm run release`.  It checks everything locally (clean tree on `main`, notes present, lint, tests, build), then tags `vX.Y.Z` and pushes the tag.

The Release workflow then runs the tests again, builds the IPK, writes the Homebrew Channel manifest, publishes a GitHub release with the CHANGELOG section as its notes, and updates the Homebrew Channel repository.  For a test build, `npm run release -- alpha.1` (or `beta.1`, `rc.1`) tags `vX.Y.Z-alpha.1`; tags with a dash become pre-releases.  Test builds are only made for `X.Y.0` versions.

## Version numbers

The app shows the full tag everywhere (`0.6.0-alpha.5`).  webOS needs `appinfo.json` versions of three plain numbers, and the Homebrew Channel offers an install whenever the repository's version differs from the installed one, so the workflow gives every build its own package version (`scripts/pkg-version.js`):

| Tag | Package version |
|---|---|
| `v0.6.0-alpha.5` | `0.5.10005` |
| `v0.6.0-beta.2` | `0.5.20002` |
| `v0.6.0-rc.1` | `0.5.30001` |
| `v0.6.0` | `0.6.0` |

Test builds sort below the release they lead up to, so moving from a test build to the release is an update.  In the repository, `appinfo.json` keeps the plain release version; only release builds are stamped.

## Homebrew Channel

Each release carries:

- `app.tivibro.tv_<package version>_all.ipk`
- `app.tivibro.tv.manifest.json`: id, version, title, icon, the IPK's link, size and SHA-256 (read by the in-app updater and `install.sh`)
- `install.sh`: the on-TV installer

The workflow also commits to the `homebrew` branch, which TVs read through raw.githubusercontent.com (GitHub's release links can't be fetched by the Homebrew Channel, which loads repositories like a web page):

- `repo.json`: the newest full release; until there is one, the newest test build
- `repo-testing.json`: the newest build of any kind
- `install.sh`: the installer from the newest build

Each repository entry carries its manifest, so the Homebrew Channel needs a single request.  Re-running an older release build never moves these back.
