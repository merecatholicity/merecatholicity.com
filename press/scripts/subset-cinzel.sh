#!/usr/bin/env bash
# Remake content/fonts/cinzel-500-subset.woff2, the press's wordmark face cut to the characters in
# content/fonts/cinzel-chars.txt (6.8 KB, against the whole Latin face's 15), which the build
# publishes under its hash (scripts/build.ts). The build refuses a press or shelf name with a
# character outside the list: add the character, run this, commit both.
#
#   press/scripts/subset-cinzel.sh     (needs fonttools and brotli: pip install fonttools brotli)
set -euo pipefail
cd "$(dirname "$0")/.."
pyftsubset node_modules/@fontsource/cinzel/files/cinzel-latin-500-normal.woff2 \
  --text="$(cat content/fonts/cinzel-chars.txt)" --flavor=woff2 --layout-features='kern,liga' \
  --output-file=content/fonts/cinzel-500-subset.woff2
ls -l content/fonts/cinzel-500-subset.woff2
