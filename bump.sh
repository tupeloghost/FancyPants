#!/bin/bash
# Stamp one version across index.html and EVERY module import, so a browser
# can never mix a fresh file with a cached one.
set -e
V="$1"
[ -z "$V" ] && { echo "usage: ./bump.sh <version>"; exit 1; }
cd "$(dirname "$0")"
# every relative import gets the same stamp
find js -name '*.js' -print0 | xargs -0 perl -pi -e "s{(from\s+'\./[^']+?\.js)(\?v=[0-9]+)?'}{\$1?v=$V'}g"
find js -name '*.js' -print0 | xargs -0 perl -pi -e "s{(from\s+'\.\./[^']+?\.js)(\?v=[0-9]+)?'}{\$1?v=$V'}g"
perl -pi -e "s{main\.js(\?v=[0-9]+)?}{main.js?v=$V}g" index.html
perl -pi -e "s{>build [0-9]+<}{>build $V<}g" index.html
echo "stamped everything at v$V"
