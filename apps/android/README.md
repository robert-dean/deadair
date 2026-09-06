# deadair for Android

Listening to the station on a phone: background playback, lock-screen controls, what is on air, and
a choice of how to receive it.

Signed in, it also shows what the station has played, what is coming up, what is on next and what
the station said between the records, and every record, album and artist has a page. Signed in as
the station's operator, it is the remote as well: skip, stop and start the station, hold a
broadcast against the schedule, set what puts the station on air, read why it is or is not on air,
reorder and drop the running order, mark records, albums, artists and breaks, and put a playlist or
a chart on air. The console is still the desk, and it deliberately does not play the mount; the
phone carries the controls worth having in a pocket and nothing that is laptop work.

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

## Signing in

Optional, and most installs will not. Listening needs no account: `/nowplaying` and the mounts are
the station's public face, which is what lets this app be pointed at an address and just work.

Signed in as the `admin`, the Now playing tab gains the transport: Skip, a Stop that arms on the
first press and fires on the second, Start while the station is stood down, the hold against the
schedule while you are the one driving, and the air mode. Every one of those is decided by the
station, not the phone: the roles it draws them from are a cached hint from `GET /auth/session`,
and a 403 re-reads them and says so.

What an account adds is the station's own account of itself — what it has played, what is on next —
which sits behind `platform.view` because it is the console's data being read by a phone. The
credentials are the OPERATOR's, the same email and password the console takes. There is no listener
account to create: `platform.view` is granted by the `listener` and `admin` roles, onboarding writes
only `admin`, and no route writes the other one. So this is a form for the person who runs the
station, on their own phone, and the section says as much.

The session is the station's own bearer and refresh token, kept in an app-private DataStore file of
their own. They are dropped on sign-out and again whenever the app is pointed at a different
station, because a token is issued by one station and means nothing to another. `PRIVACY.md` says
this in the words a listener reads; the rules that keep a refresh from being replayed are in
`SessionManager`.

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

### Publishing from CI

[`.github/workflows/android-release.yml`](../../.github/workflows/android-release.yml) builds,
verifies and uploads a signed bundle. It is **manually triggered** — Actions, Android release, Run
workflow — with a track and a status to choose. It is not on a push trigger on purpose: every
upload burns a version code permanently and lands in the console's history, and `versionCode` being
the commit count would otherwise ship a build for every README typo.

It has two modes.

**publish** builds a signed bundle from the current commit and uploads it. That is the normal one.

**promote** moves a build that is already in Play and rebuilds nothing: it makes a draft live on the
track it is already on, or carries a build from one track to a wider one. It is handed no signing
key, because it touches no artifact. Leave `version_code` blank and it takes whatever is on the
source track, which is nearly always what you mean.

Promote exists because `versionCode` is the commit count. A build is uploadable exactly once, so
"make yesterday's build live" cannot be done by running publish again — there is no new version code
to give it. That is a property of the scheme rather than a limitation of the workflow.

It needs five repository secrets. Four come from the key you already have:

```
gh secret set UPLOAD_KEYSTORE_BASE64 < <(base64 -i ~/keystores/deadair-upload.jks)
gh secret set UPLOAD_KEYSTORE_PASSWORD
gh secret set UPLOAD_KEY_ALIAS
gh secret set UPLOAD_KEY_PASSWORD
```

The fifth, `PLAY_SERVICE_ACCOUNT_JSON`, is a Google Cloud service account granted access under
Play Console → Users and permissions, with Release manager on this app. Paste the whole JSON key:

```
gh secret set PLAY_SERVICE_ACCOUNT_JSON < path/to/service-account.json
```

**Play has to have seen the app before an API upload works.** The first bundle for a package is
uploaded by hand in the console; the API cannot create an app. That is not a limitation of this
workflow.

On putting a signing key in CI at all: the key here is the UPLOAD key, not the app signing key.
Google holds the one that matters, and if an upload key is ever compromised it can be reset through
Play support. That is precisely the blast radius Play App Signing exists to shrink, and it is what
makes this trade sane. Keep the app signing key out of everything, forever.

### What a reviewer sees

This is a client for a server the reviewer does not have. On internal testing nobody reviews it
that closely, but for production the app opens on a text field asking for an address, with nothing
to type, and that reads as broken. Play's **App access** section is where to give instructions and
a reachable station, and it is worth filling in before anyone looks.

## Where the API types come from

`packages/sdk-kotlin`, generated from the `.ck` contracts by `pnpm build:contracts`. Nothing in
this app hand-writes a request or a response shape. See that package's README, and
[`CLAUDE.md`](CLAUDE.md) for the rules that apply when changing anything here.
