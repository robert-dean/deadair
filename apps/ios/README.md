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

## Publishing

The iOS release workflow uploads a build to TestFlight when an `ios-v<version>` tag is pushed on
main, or when it is run by hand. The version is decided in a changeset naming `@deadair/ios`, and the
tag has to match `MARKETING_VERSION` in `Config/Version.xcconfig`. None of it can run until Apple
has these, all of which belong to the account and none to this tree:

- an Apple Developer Program membership, with its current agreement accepted in App Store Connect;
- the App ID `com.maroonedsoftware.deadair`, and an app record in App Store Connect under it;
- an App Store Connect API key with the **Admin** role, which cloud-managed signing needs;
- in the repository's Actions settings, the secrets `APP_STORE_CONNECT_KEY_ID`,
  `APP_STORE_CONNECT_ISSUER_ID` and `APP_STORE_CONNECT_KEY_P8` (the `.p8` file, base64-encoded),
  and the variable `APPLE_TEAM_ID`.

There is no certificate or provisioning profile to keep anywhere: the workflow signs through Apple's
cloud with the key. What the App Store listing says is in `appstore/`, and what the app keeps on the
phone is in `PRIVACY.md`.
