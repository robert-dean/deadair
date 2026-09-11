# The iOS listener

`apps/ios` is the app somebody LISTENS to the station on from an iPhone, and `packages/sdk-swift` is
the generated client it talks through. It is a listener's app for anyone, with an optional sign-in
for the station's operator. The operator's remote (the transport, the running order, Skip on the lock
screen) is not built yet, and the seams it needs are: `OperatorSession`, the cached roles, and a
player whose next-track command exists and is disabled.

Every paragraph records a measured failure or a decision and the reason for it. `apps/android/CLAUDE.md`
and `apps/desktop/CLAUDE.md` hold the history most of these rules came from, and the paragraphs
below say so where they repeat one. The always-loaded index is [`CLAUDE.md`](../../CLAUDE.md).

## Where it sits

**A pnpm workspace member on paper only, deliberately.** Its `package.json` is a name, a version and
`private`, for one reader: changesets, which can number only workspace packages. No scripts and no
dependencies, so turbo finds nothing to run and the root `vitest.config.ts` finds nothing to test.
The reason is the one `apps/android` and `apps/desktop` give: an Xcode project shares no task graph,
no `dist` and no test runner with the TypeScript tree, so one CI job of its own is cheaper and more
honest than making it pretend. `.dockerignore` keeps the manifest and drops the rest, and the build
droppings are in the ROOT `.gitignore`, the only one in the tree.

**Three pieces.** `packages/sdk-swift` is the generated SDK. `Packages/DeadairCore` is a local Swift
package holding every decision that does not need a device. The Xcode project is the app: SwiftUI,
AVFoundation, MediaPlayer, the Keychain, and nothing a test could check without a phone.

## The SDK is generated, and a compile error is a generator bug

`packages/sdk-swift/Sources/**` comes out of the `.ck` contracts via `@contractkit/plugin-swift`.
**Never hand-edit it**: `pnpm build:contracts` overwrites it and CI fails on anything that moved.
`Package.swift` beside it is the one file that is ours.

**Swift that does not compile is fixed UPSTREAM**, in the ContractKit repository, with a test and a
changeset. The generator's README said its output had never met a compiler, and the Kotlin
generator's history said to expect bugs. The first build against these contracts found one: a model
with a field named `container` (`StreamConfigWarning`) failed to compile, because the generated
`encode(to:)` read the property bare beside its own local `container`. The same shadowing would have
made a literal field named `decoder` check the wrong value in `init(from:)`. The fix qualifies every
property read with `self.` and shipped in `@contractkit/plugin-swift` 0.1.4, the floor this repo
pins; 0.1.3 cannot produce Swift that compiles here. ContractKit's own tests now build and run its
generated Swift.

**Compiling is one gate and decoding is another.** The generated structs spell their own coding
keys, so the snake-case wire names that broke the Kotlin SDK's first sign-in (`access_token`,
`challenge_id`, `method_id`) were right here from the start, and `Sdk/AuthTokenDecodeTests` and
`Sdk/TokenRequestEncodeTests` keep them right. `/auth/token` goes out as a FORM, because the contract
names that type first.

**A body that fails to decode arrives as an `SdkError` with a 2xx status**, the decoder's own error
folded into a message. `StationProbe` decodes `error.body` again to tell a missing field (an older
station, `incompatible`) from a body of the wrong kind (`notAStation`), because the two are fixed
differently and the Kotlin probe tells them apart the same way.

## Three toolchain facts that are not preferences

**`swift test` without Xcode needs the framework path, and `test.sh` passes it.** The Command Line
Tools ship Swift Testing but not on the default search path, so a plain `swift test` fails with
"no such module 'Testing'" and XCTest is not there at all. `Packages/DeadairCore/test.sh` adds the
path when it exists and warnings-as-errors always; with Xcode selected it is plain `swift test`. The
tests are Swift Testing (`import Testing`, `#expect`), never XCTest, for that reason.

**The version lives in `Config/Version.xcconfig` and nowhere in the project file.** A build setting
in `project.pbxproj` silently beats the same setting in an xcconfig, so a `MARKETING_VERSION` there
would stamp every build with a number `pnpm release:version` never changes.
`scripts/release.changelog.mjs` mirrors `package.json`'s version into that one line, and the build
job's `pnpm release:version --check` fails when they disagree. `CURRENT_PROJECT_VERSION` is the
commit count, set on the release workflow's command line, for the reason Android's `versionCode` is.

**Every test lives in `DeadairCore`, and the app target has none.** It is Android's rule ("pure
logic stays free of `android.*` so plain JVM tests cover it") with a package boundary enforcing it:
the core imports Foundation, Observation and the SDK and nothing from UIKit, SwiftUI or AVFoundation,
so it builds and tests on the Mac in seconds and in CI without a simulator. Anything that decides
something goes there; the app wires it to the platform. No UI tests, as on both other apps.

## What the station does to a client

These are `docs/internals/playout.md`'s rules, repeated deliberately, as the other two apps repeat
them.

**Connecting to a mount is what puts the station on air.** `playout.airMode` defaults to `audience`,
so the first seconds after play are WARM-UP: the lease, the first record, the encoder. The desktop
measured first audio on the MP3 mount at about five seconds on the same AVFoundation stack.
`PlaybackConductor` treats a failure before the first audio as warm-up, not as a fault; only after
audio has been heard is a drop `reconnecting`, and only after the backoff is spent is it
`unreachable`. `airState` separates off air from warming up by whether this app is asking for audio,
because the station answers `onAir: false` to both.

**Never probe the mounts.** A connection, however brief, is an audience for the five-minute linger.
`GET /nowplaying` carries `mounts[]`; `chooseMount` and `availableFormats` read that and nothing else.

**One User-Agent from every request.** HLS listeners are counted per IP and agent. `AgentTransport`
overwrites the agent on every SDK request rather than trusting callers to add it, which is the
lesson of Android's image loader sending `okhttp/4.x` for months.

**Stop must drop the connection, never pause.** A paused mount is still a listener. Measured
against the station's own count: stop on MP3 took it to zero within five seconds, and stop on HLS
within twenty, because an HLS listener is counted from playlist fetches inside a fifteen-second
window. Switching MP3 to HLS while playing left the count at one, so the old connection went before
the new one came and the HLS requests carried one agent. And a CRASH does not drop it: the killed
first build went on being counted, the relaunched app read two listeners, and both went at its next
stop.

## What the listener sees

**The playhead refuses to guess.** `Playhead.project` answers `nil` without `remainingMs`, however
plausible a clock built from `startedAt` would look, and it measures carried time on the continuous
clock so a wall-clock correction cannot make it jump.

**A failed poll keeps the last good reading and marks it stale.** `PollState.unreachable` carries
it. Polling happens only while somebody holds a `PollLease` (a SwiftUI `.task` holds one through
`hold()`), with five seconds' grace, so a stopped app in the background asks the station nothing.

**The lock screen follows the audio, not the poll.** `NowPlayingGate` holds a changed record for as
long as the player has buffered and releases it early when the in-band title changes, which is
Android's gate decision for decision.

**Words: pure state returns a `Message`, never a sentence**, as on Android. `Message.text` carries
only words the station sent. The resolver that turns a `Message` into words belongs to the app and
its string catalog, and its `switch` is exhaustive, so a message without words is a compile error.

## The player is the platform's own

**AVFoundation, as on the desktop, and for the desktop's reasons.** `StationPlayer` carries over
three things `apps/desktop/native/mac/DeadairPlayer.m` measured on the same stack: a fresh item on
every play, stop as `replaceCurrentItem(with: nil)` rather than a pause, and the agent through
`AVURLAssetHTTPUserAgentKey`, which reaches the audio request, the HLS playlists and the segments
where the older header-fields option reaches only some of them and the rest go out as
AppleCoreMedia.

**First audio, measured against the live station from the simulator on 2026-09-11:** 5.2 seconds
after play on the MP3 mount, and 0.45 seconds after switching to HLS, which matches what the
desktop measured on the same stack. Five seconds of silence on MP3 is ordinary.

**The in-band title comes from `AVPlayerItemMetadataOutput`**, never the deprecated `timedMetadata`,
because it delivers a group when the AUDIO reaches it, which is the lock-screen gate's premise. Both
arrive, measured the same day. The MP3 mount's ICY `StreamTitle` came 0.4 seconds after first audio
as `Artist - Title`. The HLS stream carries ID3 `TIT2` in every segment, about every three seconds,
as the title alone, and at a record change it sent `Artist - Title` once and then the title alone.
The gate ignores a title it has just seen, so a repeat every segment costs nothing.
`log stream --info --predicate 'subsystem == "com.maroonedsoftware.deadair"'` shows each phase and
each title as it arrives.

**A closure handed to an Objective-C callback from a main-actor type must be written `@Sendable`.**
Swift 6 gives a closure written inside a `@MainActor` type the main actor, and when the API it is
handed to is not marked `Sendable` it checks at RUN time that the closure runs there. AVFoundation
fires KVO on its own queue, so the first build that played a record was killed five seconds in, as
the first audio arrived, with "BUG IN CLIENT OF LIBDISPATCH: Block was expected to execute on queue
com.apple.main-thread" and no crash report. It compiled cleanly under strict concurrency with
warnings as errors; nothing says so until it runs. The KVO observers, the artwork callback
MediaPlayer calls from its own thread, and the remote-command handlers are all explicitly
`@Sendable` for that reason, and each hops to the main actor itself.

**`Playback/Platform.swift` is the only file with iOS-only API in it**: the audio session, the
background task and `UIImage`. Everything else in the app compiles for macOS as it stands, which is
what let the app be type-checked against the real AVFoundation, MediaPlayer, Security and SwiftUI
before this machine had Xcode, with that one file stubbed. Keep it that way.

**An interruption stops and drops, and resumes only when iOS says to.** A call is an interruption
that can last longer than the station's five-minute linger, and a paused connection through it keeps
the station on air for nobody. `.ended` with `.shouldResume` plays again through warm-up; anything
else stays stopped. The route change for headphones coming out stops too: `AVPlayer` pauses on its
own there, and pause is the state this app never leaves a mount in.

**Background playback works**: locked, the app went on feeding audio for as long as it was left, a
minute in the measurement. The lock-screen information reached the system's media service in full
(title, artists, album, artwork, live, rate), but the simulator's lock screen drew no tile for it,
so what the tile looks like is still to be seen on a phone.

**iOS suspends a silent app about thirty seconds after it leaves the screen, and neither other app
has that problem.** A dropped stream in a pocket is exactly a silent app. So a pending reconnect
holds a background task, which the backoff's first waits fit inside, and after that the lock-screen
tile is what the listener presses. The tile survives suspension but not termination: iOS has no
`MediaButtonReceiver`, so a play press in a car cannot start an app that has been swiped away.
CarPlay and an `AudioPlaybackIntent` are the two real routes to that, and neither is built.

**A station on the home network triggers iOS's Local Network prompt**, the first time the app
connects to a local address, and `NSLocalNetworkUsageDescription` in `Config/Info.plist` is what the
prompt says. Plain HTTP is allowed by `NSAllowsArbitraryLoads`, for the reason Android's
`network_security_config` allows cleartext: the address is whatever the listener types, and a home
install has no certificate.

**Artwork goes through `ArtworkLoader`, never `AsyncImage`**, which fetches through
`URLSession.shared` under the system's agent: a second listener every time the record changes, the
bug Android found in its media session's bitmap loader.

**The Keychain item is `AfterFirstUnlockThisDeviceOnly`.** Readable in the background once the phone
has been unlocked since boot, which is when a lock-screen press can reach the app, and never in a
backup or on a new phone, which is what `PRIVACY.md` promises. Changing the accessibility changes the
policy.

**Swift 6.3 crashed in IR generation on a main-actor method passed straight in as a `Binding`
setter** (`set: entry.type`). An explicit closure (`set: { entry.type($0) }`) compiles, and the
screens use that form throughout.

## The session

**Listening is accountless and stays that way.** A session buys `platform.view` reads and, for the
`admin`, the operator's verbs; nothing about hearing the station. The credentials are the operator's.

**The refresh is single-flight, and that is not tidiness.** Refresh tokens are single-use and
rotating, and presenting a spent one revokes every token descended from that sign-in. The manager
lives on the main actor, so instead of a lock a second caller awaits the refresh already in flight,
and a caller whose token was already replaced takes the replacement. `refreshesExactlyOnceWhenTwoCallsMeetTheSameExpiry`
holds two 401s at a barrier so both arrive with the old token; with the in-flight share removed it
counts two refreshes, which is how it is known to test the thing.

**A session ends on a 4xx to the refresh and on nothing else.** A 5xx or a network failure is
rethrown with the session untouched.

**Roles come from `GET /auth/session`, are cached beside the tokens, and are a HINT.** A 403 on
that read is stored as no roles. `ensureRoles` asks once per process per account, and a failure is
not remembered as done.

**The second factor is answered against the AUTHENTICATOR**, picked out of the challenge's factors,
never its first entry, and the three refusals that share one 401 are told apart by
`WWW-Authenticate`. Both are the desktop app's shipped bug.

```bash
apps/ios/Packages/DeadairCore/test.sh
swift build --package-path packages/sdk-swift -Xswiftc -warnings-as-errors
```

## What has been verified

`DeadairCore`'s tests pass, 177 of them, with warnings as errors, under both the Command Line Tools
and Xcode 26.6, and the single-flight test was shown to fail with the in-flight share removed. The
generated SDK compiles in Swift 6 mode with strict concurrency. The app builds for the iOS simulator
with no warnings, from the hand-written project file, on the first attempt.

Against the live station, on an iPhone 17 Pro simulator running iOS 26.5: the address check found
the station by name; the player read off air, then warming up, then the record with its artwork and
a moving playhead; MP3 and HLS both played, with the timings and titles above; stop dropped the
connection on both; the format picker greyed the two formats the station does not publish; and
audio went on with the phone locked.

Not yet: a real phone, the lock-screen tile's appearance, an interruption from a call, a reconnect
after a dropped stream, the background task running out, sign-in against the station, and anything
that needs the Apple account.
