#!/bin/bash
# Generate macOS .iconset from the workforce SVG logo.
# Usage: ./scripts/generate-icons.sh [source.svg]
#
# Requires: qlmanage (macOS built-in), sips (macOS built-in)

set -euo pipefail

SRC="${1:-public/workforce-logo.svg}"
ICONSET="icon.iconset"
TMP_DIR=$(mktemp -d)
TMP_PNG="$TMP_DIR/icon-1024.png"

if [ ! -f "$SRC" ]; then
  echo "Error: Source SVG not found: $SRC"
  exit 1
fi

echo "Rendering $SRC → 1024x1024 PNG..."
qlmanage -t -s 1024 -o "$TMP_DIR" "$SRC" > /dev/null 2>&1
# qlmanage appends .png to the filename
mv "$TMP_DIR/$(basename "$SRC").png" "$TMP_PNG"

echo "Generating iconset sizes..."
mkdir -p "$ICONSET"

sips -z   16   16 "$TMP_PNG" --out "$ICONSET/icon_16x16.png"      > /dev/null
sips -z   32   32 "$TMP_PNG" --out "$ICONSET/icon_16x16@2x.png"   > /dev/null
sips -z   32   32 "$TMP_PNG" --out "$ICONSET/icon_32x32.png"      > /dev/null
sips -z   64   64 "$TMP_PNG" --out "$ICONSET/icon_32x32@2x.png"   > /dev/null
sips -z  128  128 "$TMP_PNG" --out "$ICONSET/icon_128x128.png"    > /dev/null
sips -z  256  256 "$TMP_PNG" --out "$ICONSET/icon_128x128@2x.png" > /dev/null
sips -z  256  256 "$TMP_PNG" --out "$ICONSET/icon_256x256.png"    > /dev/null
sips -z  512  512 "$TMP_PNG" --out "$ICONSET/icon_256x256@2x.png" > /dev/null
sips -z  512  512 "$TMP_PNG" --out "$ICONSET/icon_512x512.png"    > /dev/null
sips -z 1024 1024 "$TMP_PNG" --out "$ICONSET/icon_512x512@2x.png" > /dev/null

echo "Building icon.icns..."
iconutil -c icns "$ICONSET" -o icon.icns

rm -rf "$TMP_DIR"

echo "Done: $(ls "$ICONSET" | wc -l | tr -d ' ') icons in $ICONSET/, icon.icns generated"
echo "Restart 'bun run dev' to see the updated Dock icon."
