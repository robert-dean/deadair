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

## The launcher icon

The station's own mark, the skull the console wears, and it is generated from
`apps/web/public/logo.png` rather than drawn again — one artwork, two places, no chance of them
drifting apart. Regenerate after that file changes:

```
python3 -m venv /tmp/iconvenv && /tmp/iconvenv/bin/pip install Pillow
/tmp/iconvenv/bin/python apps/android/tools/make-launcher-icon.py
```

The PNGs it writes into `res/drawable-*` are committed. Pillow is not a project dependency: this
runs by hand on the rare day the mark changes and no Gradle task calls it.

Two things about the shape of it. The field is the adaptive icon's BACKGROUND layer and the skull
is the FOREGROUND, so a launcher's mask — circle, squircle, teardrop — cuts the green and never the
drawing. And the arched "deadair radio" of the full lockup is left off, exactly as
`station.mark.tsx` leaves it off the console header: at this size it is illegible, and there is no
wordmark beside a launcher icon to carry the name.

The script's own header says why it is a script rather than an exported crop.

## Releasing it

The app ships through Google Play under the Marooned Software account, currently to the **internal
testing** track: testers are named by email address, review is light, and it installs and updates
through Play like anything else. A production listing is a separate decision and needs a store
listing, a content rating, a data safety form and a privacy policy; none of that is required to put
a build on internal testing.

Play wants an **App Bundle**, not an APK:

```
./gradlew :app:bundleRelease
```

The output is `app/build/outputs/bundle/release/app-release.aab`. Upload it under Testing →
Internal testing → Create new release.

### The upload key

Play App Signing holds the key the app is really signed with. The key here only proves an upload
came from us, and it lives **outside the repo**: `~/keystores/deadair-upload.jks`, with its path
and passwords in `~/.gradle/gradle.properties` under four `deadair.upload.*` properties. A checkout
therefore carries no secret, and `*.jks` is gitignored so one cannot wander in.

Back up that keystore and those four lines together. It is the one artifact in this project that
cannot be regenerated: without it the published app can never be updated, only replaced under a new
application id, which means every listener reinstalling by hand.

A build with no key configured still works. It produces an unsigned bundle rather than failing,
which is what lets CI run `bundleRelease` on every push to catch R8 breaking.

### The version code

Derived from `git rev-list --count HEAD`, so it rises with every commit and no release step has to
remember to bump anything. Play refuses a code it has already accepted, and forgetting is the usual
way that goes wrong. `versionName` stays hand-written, because it is a decision rather than a fact
about the tree.

A shallow checkout answers 1. That is why CI's bundle is not uploadable, and it does not need to
be.

### The privacy policy

[`PRIVACY.md`](PRIVACY.md), and Play needs it at a public URL rather than as a file: the GitHub
blob URL for it is enough. It is short because the app genuinely collects nothing, and it is
accurate about the two things somebody would otherwise miss — the station is a server the listener
chose and Marooned Software does not run it, and cover art may be fetched from a third-party image
host when the station's own metadata points at one rather than at its cached copy.

Keep it true if the app ever gains a dependency that phones home.

### What a reviewer sees

This is a client for a server the reviewer does not have. On internal testing nobody reviews it
that closely, but for production the app opens on a text field asking for an address, with nothing
to type, and that reads as broken. Play's **App access** section is where to give instructions and
a reachable station, and it is worth filling in before anyone looks.

## Where the API types come from

`packages/sdk-kotlin`, generated from the `.ck` contracts by `pnpm build:contracts`. Nothing in
this app hand-writes a request or a response shape. See that package's README, and
[`CLAUDE.md`](CLAUDE.md) for the rules that apply when changing anything here.
