Releases are built by GitHub Actions.  Every push and pull request also runs lint, tests and a test build.

1. `bash scripts/bump-version.sh X.Y.Z`
2. In `CHANGELOG.md`, rename `## Unreleased` to `## X.Y.Z (date)`, then commit.
3. `npm run release`.  It checks everything locally (clean tree on `main`, notes present, lint, tests, build), then tags `vX.Y.Z` and pushes the tag.

The Release workflow then runs the tests again, builds the IPK, writes the Homebrew Channel manifest and `repo.json`, and publishes a GitHub release with the CHANGELOG section as its notes.  For a pre-release, `npm run release -- alpha.1` tags `vX.Y.Z-alpha.1`; tags with a dash become pre-releases and are not what the Homebrew Channel repository installs.

## Homebrew Channel

Each release carries:

- `app.tivibro.tv_<version>_all.ipk`
- `app.tivibro.tv.manifest.json`: id, version, title, icon, the IPK's size and SHA-256
- `repo.json`: points the Homebrew Channel at `releases/latest/download/app.tivibro.tv.manifest.json`, so the newest release is always what installs

Once the repository is public, adding its `repo.json` address as a custom repository in the Homebrew Channel is all a user needs.
