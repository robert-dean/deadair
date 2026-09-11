#!/usr/bin/env bash
# `swift test` for this package, from anywhere.
#
# With Xcode installed this is plain `swift test`. With only the Command Line Tools, Swift Testing
# is present but off the default search path, so the framework directory is passed in; the flags
# are harmless when Xcode is the active developer directory.
set -euo pipefail
cd "$(dirname "$0")"
frameworks="$(xcode-select -p)/Library/Developer/Frameworks"
libs="$(xcode-select -p)/Library/Developer/usr/lib"
extra=()
if [ -d "$frameworks" ]; then
    extra=(-Xswiftc -F -Xswiftc "$frameworks" -Xlinker -F -Xlinker "$frameworks" -Xlinker -rpath -Xlinker "$frameworks" -Xlinker -rpath -Xlinker "$libs")
fi
exec swift test -Xswiftc -warnings-as-errors ${extra[@]+"${extra[@]}"} "$@"
