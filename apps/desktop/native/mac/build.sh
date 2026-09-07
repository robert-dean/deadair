#!/usr/bin/env bash
# Builds the AVFoundation shim the desktop player calls through.
#
# clang ships with the Command Line Tools, so this needs no workload, no Xcode project and no
# toolchain a CI runner does not already have. Output goes beside the sources and is gitignored; the
# player project copies it into the build, and the bundle script puts it in Contents/Frameworks.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/build"
mkdir -p "$out"

# arm64 only, matching the first release's target. A second `-arch x86_64` makes it universal when
# an Intel Mac becomes worth supporting.
clang -dynamiclib \
    -arch arm64 \
    -mmacosx-version-min=13.0 \
    -fobjc-arc \
    -framework AVFoundation \
    -framework Foundation \
    -install_name @rpath/libdeadairplayer.dylib \
    -o "$out/libdeadairplayer.dylib" \
    "$here/DeadairPlayer.m"

echo "built $out/libdeadairplayer.dylib"
