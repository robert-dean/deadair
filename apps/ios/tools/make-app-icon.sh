#!/usr/bin/env bash
# Build the iOS app icon from the desktop app's, which is built from the console's mark.
#
# Run after `apps/desktop/tools/macos/make-app-icon.py` has rebuilt `deadair.icns`, which it does
# when `apps/web/public/logo-mark.png` changes. What this writes is committed, so the Xcode build
# needs neither.
#
# The desktop's 1024-pixel frame rather than a second compositing script, because the two platforms
# want the same picture: a FULL-BLEED square, the skull lifted off the mark onto its own green at 72%
# of the canvas, which the system then cuts to its own rounded shape. The desktop script's comment
# says how that was decided and checked. The one difference is the alpha channel: the App Store
# refuses an icon with one, so the frame goes through JPEG and back, which flattens it onto the
# green it already fills.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
icns="$root/apps/desktop/tools/macos/deadair.icns"
out="$root/apps/ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
iconutil -c iconset "$icns" -o "$work/deadair.iconset"
sips -s format jpeg -s formatOptions best "$work/deadair.iconset/icon_512x512@2x.png" --out "$work/flat.jpg" > /dev/null
sips -s format png "$work/flat.jpg" --out "$out" > /dev/null
sips -g pixelWidth -g pixelHeight -g hasAlpha "$out"
