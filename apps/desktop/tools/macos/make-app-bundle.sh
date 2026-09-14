#!/usr/bin/env bash
# Builds deadair.app for Apple Silicon.
#
# `dotnet publish` produces a directory of files, and macOS wants a bundle: the executable in
# Contents/MacOS, resources in Contents/Resources, and an Info.plist naming the executable. This does
# that, puts the AVFoundation shim beside the executable where the runtime will find it, and signs the
# result ad hoc.
#
# Deliberately NOT `PublishTrimmed`: the generated SDK reads JSON by reflection and the trimmer cannot
# see it. And deliberately NOT `IncludeNativeLibrariesForSelfExtract`, which is incompatible with
# macOS and fails at run time with "Failed to create CoreCLR" rather than at publish.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
# `Directory.Build.props` is the one place the desktop app's version is written. Read it rather than
# repeating it: this literal was in four places at once (here, the props file, the release workflow's
# default, and the release notes), which is three chances for a bundle to disagree with the assembly
# inside it. An argument still overrides, for building a one-off by hand.
version="${1:-$(dotnet msbuild "$root/Directory.Build.props" -getProperty:Version 2>/dev/null | tr -d '[:space:]')}"
if [ -z "$version" ]; then
    echo "could not read Version from Directory.Build.props, and none was given" >&2
    exit 1
fi

out="$root/artifacts"
app="$out/deadair.app"

"$root/native/mac/build.sh"

# The publish directory too, not only the bundle: publish writes over what is there and deletes
# nothing, and the whole directory is copied into the app below, so a file an earlier build left
# behind would ship. Found when a renamed plugin folder turned up in the bundle under both names.
rm -rf "$app" "$out/publish"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

# The projects declare `osx-arm64` in Directory.Build.props, so this publish and an ordinary build
# agree about what the lock files hold and a packaging run cannot break the next build.
dotnet publish "$root/src/MaroonedSoftware.Deadair.Desktop" \
    --configuration Release \
    --runtime osx-arm64 \
    --self-contained true \
    -p:PublishTrimmed=false \
    -p:PublishSingleFile=false \
    --output "$out/publish"

cp -R "$out/publish/." "$app/Contents/MacOS/"

# Beside the executable, with the thirty-odd dylibs the self-contained publish already put there
# (the runtime, Skia, HarfBuzz, Avalonia's native half). This used to say every dylib belongs in
# Contents/Frameworks while copying this one into MacOS, and the code was the right half: the player
# is found by the runtime's default native probing, which looks in the application directory and never
# in Frameworks. Frameworks is Apple's convention for .framework bundles reached through @rpath, not a
# notarisation rule; the rule is that every Mach-O is signed wherever it sits, which the step below does.
cp "$root/native/mac/build/libdeadairplayer.dylib" "$app/Contents/MacOS/"

# The icon is a committed .icns rather than one built here: `make-app-icon.py` needs Pillow, and a
# packaging run should not need a Python environment to produce the same bytes every time. Rebuild it
# by hand when the mark changes.
cp "$here/deadair.icns" "$app/Contents/Resources/"

sed "s/__VERSION__/$version/g" "$here/Info.plist.in" > "$app/Contents/Info.plist"

chmod +x "$app/Contents/MacOS/deadair"

# Signed ad hoc: innermost first, then the bundle, which seals what is already signed inside it. Not
# `--deep`, which Apple deprecates for signing and which signs in an order it documents as wrong. This
# covers the plugins' folders too, since they sit under MacOS.
#
# EVERY file under MacOS, not only the dylibs. codesign treats everything in Contents/MacOS as code,
# so signing just the Mach-O files was measured to fail the strict check on the first managed
# assembly it met ("code object is not signed at all, In subcomponent: System.Threading.ThreadPool.dll").
# A file that is not Mach-O carries its signature in extended attributes, which is one more reason the
# release archives with `ditto`: a plain zip would drop them. The executable itself is signed by the
# bundle's own signature, last.
#
# What ad hoc buys, stated honestly: NOT Gatekeeper's acceptance, which only notarisation gives. It
# buys a bundle `codesign --verify --strict` passes, so anything that would fail notarisation fails
# here first, and signing it properly later is swapping `-` for an identity.
#
# Under the hardened runtime, because notarisation refuses anything without it and because it is the
# part that can stop the app starting, which is worth finding out on an ad hoc build rather than on
# the first notarised one. Every nested file gets the flag, not only the executable: `createdump` is
# a second executable in the publish and notarisation checks it too. The entitlements go on the
# bundle's signature, which is the main executable's, and `deadair.entitlements` says what each one is
# for and what happened without it.
find "$app/Contents/MacOS" -type f ! -path "$app/Contents/MacOS/deadair" -print0 \
    | xargs -0 codesign --force --options runtime --sign -
codesign --force --options runtime --entitlements "$here/deadair.entitlements" --sign - "$app"
codesign --verify --strict --verbose=2 "$app"

# `--verify` passes a bundle with no hardened runtime just as happily, so check the flag outright.
# Captured first rather than piped into `grep -q`, which exits at the first match, leaves codesign
# writing to a closed pipe, and under `pipefail` turns a pass into a failure.
signature="$(codesign --display --verbose=2 "$app" 2>&1)"
if ! grep -q '^CodeDirectory.*flags=.*runtime' <<< "$signature"; then
    echo "the bundle is not signed with the hardened runtime" >&2
    exit 1
fi

echo "built $app"
echo
echo "It is signed only ad hoc and not notarised, so macOS refuses the first launch. macOS 15 removed"
echo "the right-click and Open route: open it once, let it refuse, then go to System Settings,"
echo "Privacy & Security, and press Open Anyway. Or: xattr -dr com.apple.quarantine <path to deadair.app>"
