#!/usr/bin/env bash
# Builds deadair.app for Apple Silicon.
#
# `dotnet publish` produces a directory of files, and macOS wants a bundle: executables in
# Contents/MacOS, dylibs in Contents/Frameworks, and an Info.plist naming the executable. This does
# that, and puts the AVFoundation shim where the runtime will find it.
#
# Deliberately NOT `PublishTrimmed`: the generated SDK reads JSON by reflection and the trimmer cannot
# see it. And deliberately NOT `IncludeNativeLibrariesForSelfExtract`, which is incompatible with
# macOS and fails at run time with "Failed to create CoreCLR" rather than at publish.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
version="${1:-0.1.0}"

out="$root/artifacts"
app="$out/deadair.app"

"$root/native/mac/build.sh"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Frameworks"

dotnet publish "$root/src/MaroonedSoftware.Deadair.Desktop" \
    --configuration Release \
    --runtime osx-arm64 \
    --self-contained true \
    -p:PublishTrimmed=false \
    -p:PublishSingleFile=false \
    --output "$out/publish"

cp -R "$out/publish/." "$app/Contents/MacOS/"

# Every dylib belongs in Frameworks. The runtime finds them there because the executable's rpath
# includes it, and a .app with dylibs loose in MacOS is one that fails notarisation later.
mkdir -p "$app/Contents/Frameworks"
cp "$root/native/mac/build/libdeadairplayer.dylib" "$app/Contents/MacOS/"

sed "s/__VERSION__/$version/g" "$here/Info.plist.in" > "$app/Contents/Info.plist"

chmod +x "$app/Contents/MacOS/deadair"

echo "built $app"
echo
echo "It is unsigned, so the first launch needs a right-click and Open."
