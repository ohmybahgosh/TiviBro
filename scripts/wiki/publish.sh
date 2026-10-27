#!/usr/bin/env bash
# Publishes docs/wiki/ to the repository's GitHub wiki.
#   node scripts/wiki/build.js && bash scripts/wiki/publish.sh
# GitHub creates the wiki's git repository only after its first page exists, so the very first
# time, open the Wiki tab on GitHub, press "Create the first page" and save it as is.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URL="${WIKI_GIT:-$(git -C "$ROOT" remote get-url origin | sed 's/\.git$//').wiki.git}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if ! git clone -q "$URL" "$TMP/wiki" 2>/dev/null; then
  echo "Could not clone $URL" >&2
  echo "Open the Wiki tab on GitHub, create the first page, then run this again." >&2
  echo "(Wikis on private repositories need a paid GitHub plan; on a free plan, make the repository public first.)" >&2
  exit 1
fi
find "$TMP/wiki" -maxdepth 1 -name '*.md' -delete
cp "$ROOT"/docs/wiki/*.md "$TMP/wiki/"
cd "$TMP/wiki"
git add -A
if git diff --cached --quiet; then echo "Wiki already up to date."; exit 0; fi
git -c user.name="$(git -C "$ROOT" config user.name || echo TiviBro)" -c user.email="$(git -C "$ROOT" config user.email || echo noreply@github.com)" \
  commit -q -m "Update wiki from docs/wiki ($(git -C "$ROOT" rev-parse --short HEAD))"
git push -q
echo "Wiki published: ${URL%.wiki.git}/wiki"
