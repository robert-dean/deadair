# deadair for Android

Listening to the station on a phone: background playback, lock-screen controls, what is on air, and
a choice of how to receive it.

Not an operator's app. The console is that, and it deliberately does not play the mount; this
deliberately does nothing else.

## Building it

Needs a JDK 21 and the Android SDK. On a Mac with Homebrew:

```bash
brew install openjdk@21 && brew install --cask android-commandlinetools
```

Then, with `ANDROID_HOME` set to where you want the SDK (`~/Library/Android/sdk` is conventional):

```bash
sdkmanager "platform-tools" "emulator" "platforms;android-37.2" "build-tools;37.0.0" "system-images;android-36;google_apis;arm64-v8a"
```

Gradle comes from the committed wrapper, so there is nothing to install for it.

```bash
cd apps/android && ./gradlew :app:assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/`. `adb install -r` it onto a phone, or run it on an
emulator:

```bash
avdmanager create avd -n deadair -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_8
```

What CI runs, and what to run before pushing:

```bash
cd apps/android && ./gradlew :sdk:build :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

## The address to give it

The one the station's console loads from. One port carries the console, the API under `/api` and
the stream itself, so that single address is the whole of the configuration — everything else is
derived from it.

It is checked before it is kept: the app asks `/nowplaying` and shows you the name that answered.
Plain `http://` is accepted without complaint, because TLS terminates outside the station's
container and a LAN install has no other option; the app says so once, under the field.

Against a dev stack from an emulator, that address is `http://10.0.2.2:8080`.

## The format picker

MP3 is always there — `stream.mount` has no switch. The others are the operator's to enable, and
the picker greys out the ones this station does not publish, reading that from `/nowplaying`'s
`mounts[]` rather than by connecting to each mount to see. That is not an optimisation: a
connection is an audience, and an audience-gated station would be put on air for five minutes by
somebody opening the settings screen.

HLS is the one to choose on a phone that moves between wifi and mobile data. An Icecast mount is a
single long-lived TCP connection and does not survive the handoff; HLS is a sequence of requests
and does.

## Where the API types come from

`packages/sdk-kotlin`, generated from the `.ck` contracts by `pnpm build:contracts`. Nothing in
this app hand-writes a request or a response shape. See that package's README, and
[`CLAUDE.md`](CLAUDE.md) for the rules that apply when changing anything here.
