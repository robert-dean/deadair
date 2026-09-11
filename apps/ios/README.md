# deadair for iPhone

Listening to the station on an iPhone: background playback, the lock screen and Control Center,
what is on air, and a choice of how to receive it. Signing in with the station's operator account is
optional, and the operator's remote that the Android app has is not built here yet.

## Building it

Needs Xcode 16 or later, from the App Store, selected as the developer directory:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Open `apps/ios/Deadair.xcodeproj` and run the `Deadair` scheme on a simulator, or from a terminal:

```bash
xcodebuild build -project apps/ios/Deadair.xcodeproj -scheme Deadair -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

Running on a phone needs a signing team: set one under Signing & Capabilities, and do not commit it.

Every test the app has is in `Packages/DeadairCore`, and runs on the Mac with no simulator. What CI
runs, and what to run before pushing:

```bash
swift build --package-path packages/sdk-swift -Xswiftc -warnings-as-errors
apps/ios/Packages/DeadairCore/test.sh
```

## The address to give it

The one the station's console loads from. One port carries the console, the API under `/api` and
the stream itself, so that single address is the whole of the configuration.

It is checked before it is kept: the app asks `/nowplaying` and shows you the name that answered.
Plain `http://` is accepted, because TLS terminates outside the station's container and a home
install has no other option; the app says so once, under the field. A station on your own network
makes iOS ask for Local Network access the first time, which is expected.

Against a dev stack on the same Mac, the simulator reaches it at `http://localhost:8080`.

## The format picker

MP3 is always there. The others are the operator's to switch on, and the picker greys out the ones
this station does not publish, reading that from `/nowplaying`'s `mounts[]` rather than by
connecting to each mount to see: a connection is an audience, and an audience-gated station would be
put on air for five minutes by somebody opening Settings.

HLS is the one to choose on a phone that moves between wifi and mobile data. An Icecast mount is a
single long-lived connection and does not survive the handover; HLS is a series of requests and does.

