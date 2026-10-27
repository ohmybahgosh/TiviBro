#!/usr/bin/env bash
# Cut a release: checks everything, tags vX.Y.Z and pushes the tag.  GitHub Actions does the rest
# (tests, build, IPK, Homebrew manifest, GitHub release).
#   bash scripts/release.sh            release the version in app/appinfo.json
#   bash scripts/release.sh alpha.1    a pre-release of it, tagged vX.Y.Z-alpha.1
# Before running: bash scripts/bump-version.sh X.Y.Z, rename "## Unreleased" in CHANGELOG.md to
# "## X.Y.Z (date)", and commit.
source "$(dirname "$0")/_common.sh"
cd "$ROOT"
PRE="${1:-}"
TAG="v$VERSION${PRE:+-$PRE}"
[ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first." >&2; git status --short >&2; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Release from main." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "Tag $TAG already exists.  Bump the version first." >&2; exit 1; }
node scripts/release-notes.js "$VERSION" >/dev/null
bash scripts/lint.sh
npm test --silent
bash scripts/build.sh
git push origin main
git tag -a "$TAG" -m "TiviBro ${TAG#v}"
git push origin "$TAG"
echo "Pushed $TAG.  Watch the release build: gh run watch  (or the Actions tab on GitHub)"
