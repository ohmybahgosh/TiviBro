#!/usr/bin/env bash
# Set one version everywhere:  bash scripts/bump-version.sh 0.5.1
source "$(dirname "$0")/_common.sh"
NEW="${1:?usage: bump-version.sh X.Y.Z}"
for f in app/appinfo.json service/package.json package.json; do
  node -e "const f='$ROOT/$f',j=require(f);j.version='$NEW';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
done
node -e "const f='$ROOT/package-lock.json',j=require(f);j.version='$NEW';if(j.packages&&j.packages[''])j.packages[''].version='$NEW';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
sed -i "s/^var TIVIBRO_VERSION = .*/var TIVIBRO_VERSION = '$NEW';/" "$ROOT/app/js/log.js"
echo "Version $VERSION -> $NEW.  Now add a CHANGELOG entry."
