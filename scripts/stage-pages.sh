#!/bin/sh
# Copy the static app to dist/ for `npx wrangler pages deploy dist`.
# Paths stay relative, so this folder is the site root.
set -e
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist/privacy
cp index.html app.js auth.js handoff.js community.js garmin-import.js garmin-connect.js \
  garmin-brand.png manifest.json style.css sw.js privacy.html icon-192.png icon-512.png dist/
cp privacy/index.html dist/privacy/
for extra in favicon-32.png icon-180.png icon-maskable-512.png; do
  if [ -f "$extra" ]; then
    cp "$extra" dist/
  fi
done
echo "dist/ is ready"
