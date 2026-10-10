# The iOS listener

`apps/ios` is the app somebody LISTENS to the station on from an iPhone, and `packages/sdk-swift` is
the generated client it talks through. It is a listener's app for anyone, with an optional sign-in
for the station's operator. Signed in as the operator it is also the remote Android is: Skip and
Shuffle on Now playing and the lock screen, the running order to edit, the desk, Manage, replanning a
show and putting something on air. Its screens are Android's layouts, measure for measure; Android is
the reference whenever the two differ, and a difference should be a recorded decision, not drift.

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
`unreachable`. A wait for audio that never ends is a drop too: `AVPlayer` reports a dead
connection as a failure only some of the time, and otherwise waits for ever under a screen saying
playing, so the conductor gives a wait ten seconds once audio has been heard and thirty before
(`stallLimit`, `warmUpLimit`), then retries it as the failure the player did not report. Not yet
seen happen on a phone; the limits are reasoned, not measured. `airState` separates off air from warming up by whether this app is asking for audio,
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
long as the player has buffered (less the reading's age) and releases it early when the in-band
title changes, which is Android's gate decision for decision. A title change with nothing held asks
the station for a fresh reading and publishes that answer at once; it used to republish the latest
reading, which was the record that had just ended.

**So do Now playing and the player bar, while this phone plays.** They drew the poll, and named the
next record a buffer before the music changed. `Listening.aired` is the gate's release with its
`readAt` moved later by the WHOLE buffer (the listener is a buffer behind at every moment, however
old the reading), and `AppModel.heardState` swaps it in while playing; stopped, the poll is drawn.
`Playhead.project` lets `now` fall before `readAt` for that reason: clamping that gap held the bar
still for a buffer after every reading. Android's `heard` and `aired`, case for case.

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

**Now playing and Up next wear the on-air cover's colours**, Android's rule: `CoverPalette`
(`coverAccent`, `meshColors`, ported with their tests) decides from the colours `Platform.coverColors`
counts off a 24-by-24 copy of the cover. The accent tints the controls only, and a cover with no colour
worth a button (black and white) keeps the app's green while still getting a grey mesh. The mesh drifts
while the station is on air, stands still on Up next and with Reduce Motion, and is re-read when the
page turns light or dark.

**Now playing is Android's layout, measure for measure, and the measures are in the file.** Upright,
the cover runs the width with both edges dissolving into the mesh, and gives way on a short phone
(`belowCover`, at least `minCover`) so the controls never do: on the iPhone SE it is 298 points.
The page is laid out INSIDE the safe area and only its background bleeds past it. With the reader
ignoring the safe area its insets read zero, the cover never gave way, and on the SE the play button
went under the tab bar (2026-10-02). While the tabs are away the stack keeps the height it had with
them, so it does not drop into the room they leave. Resting needs a record coming out of the phone
(`canRest`), never runs under VoiceOver, and its waking touch is swallowed by a layer drawn only
while resting. No sleep timer, listener count or fallback note on the screen: the timer is a row in
Settings' Listening section and the fallback is said under the format it is about.

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
before this machine had Xcode, with that one file stubbed. Keep it that way. (`CarPlay/` is wrapped
in `#if canImport(CarPlay)` for this reason, and `Intents/` is AppIntents, which the Mac has.)

**The session is activated off the main thread; the category is not.** `setActive` waits on the media
server, and a phone logged a "Hang Risk" fault on every play and stop while it ran on the main thread
(2026-10-02). It runs on one serial queue, so a stop pressed straight after a play still deactivates
second. The `.playback` category is set before `activateAudio()` returns, because the player can
start before the activation lands, and a player that activates the session itself does so under
whatever category is set: the default one is muted by the silent switch. iOS 27's asynchronous
`activate`/`deactivate` would do the same job, but the deployment target is 17.

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
CarPlay and an `AudioPlaybackIntent` are the two real routes to that, and both are built (the next
two paragraphs). The intent works today; CarPlay is built and waits on Apple.

**`PlayStationIntent` is an `AudioPlaybackIntent`, and it is the route that starts a swiped-away
app.** The system runs it in the app's own process, launching it in the background, and it calls
`Listening.play()`, the Play button's own call. `AppModel.shared` is the one graph in the process
(the window, the intent and the CarPlay scene all read it), and that is what stops a second player
existing: do not build an `AppModel` anywhere else. `DeadairShortcuts` offers it to Siri and
Shortcuts with no set-up. With no station kept it throws a sentence rather than reporting a start.

**CarPlay's list holds exactly one row, the station, and must never hold a second.** Android Auto's
rule (`apps/android/CLAUDE.md`, "Android Auto's library holds exactly one item"), for its reason: a
second row (one per format) is a second thing to press, and a head unit reads a list as something with
a next that is not the operator's Skip. `CarStationItem` in `DeadairCore` is a value, not a
collection, and is what the row says: the station's name, the lock screen's two lines when tuned in
(and nothing before, because a reading left over from before stop is not what is playing), the cover or
the presenter's portrait (`coverArtUrl`), and a line sending the listener to the phone when no station
is kept. The scene (`CarPlay/CarPlaySceneDelegate.swift`) draws it into a `CPListTemplate`, redraws
only when the value changed, and on selection calls `Listening.play()` and pushes
`CPNowPlayingTemplate.shared`. That template reads `MPNowPlayingInfoCenter` and sends its buttons to
the remote commands `SystemNowPlaying` already answers, so nothing is published for the car a second
time. The row reads `Listening.shown`, the reading the gate has RELEASED, so the car and the lock screen
tile never disagree about which record is on. The root is built synchronously in `didConnect` from
held state, the iOS counterpart of Android's root rule: nothing there waits on the network. The
file is `#if canImport(CarPlay)`, so the macOS type-check described below still holds. Not looked at in
a car or on the simulator's CarPlay window yet (2026-10-05): the build is clean and the phone's own
window launches with the scene manifest, nothing more.

**The CarPlay entitlement is the one thing in this tree that can break a device build, so it is
applied by SDK and is OFF for every device build.** Apple has not granted `com.apple.developer.carplay-audio`
to this app. A signed device or archive build that names an entitlement the provisioning profile does
not hold fails to sign, which would stop TestFlight (`ios-release.yml` archives for
`generic/platform=iOS` with automatic signing) and every personal-team run. So `Config/Deadair.carplay.entitlements`
is referenced only by `CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]` in the target's two configurations:
simulator builds carry it (the simulator's CarPlay window needs it to connect a scene, and a
simulator build needs no profile), and `xcodebuild -showBuildSettings -sdk iphoneos` answers no
entitlements file at all. CI builds for the simulator with signing off, so it embeds nothing either.
Everything else is safe without it: the scene manifest in `Config/Info.plist` only declares a role
CarPlay never connects to, and the delegate is never instantiated, so the app is exactly what it was.
That is also why `INFOPLIST_KEY_UIApplicationSceneManifest_Generation` is `NO`: the generated manifest
beats the file's, with an empty `UISceneConfigurations`, and the CarPlay role never reached the built
plist. SwiftUI still makes the phone's window without a window role declared.

**To turn CarPlay on for device builds once Apple grants it:** request the CarPlay Audio entitlement
at developer.apple.com for `com.maroonedsoftware.deadair` (the CarPlay request form, which is
reviewed by hand), then make sure the App ID has the capability and let automatic signing regenerate
the profile (`-allowProvisioningUpdates` in the release workflow does so on the next archive). Only
then change `CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]` to plain `CODE_SIGN_ENTITLEMENTS` in both
target configurations in `project.pbxproj`, so the file applies to every SDK. Do that BEFORE the grant
and the next TestFlight upload fails to sign.

**With no network, a drop waits for one instead of spending the backoff.** `Platform.observeNetwork`
(an `NWPathMonitor`, satisfied rather than internet-reaching, for a home station) feeds
`PlaybackConductor.networkChanged`: a failure while there is none schedules nothing, and the
network's return makes the retry due at once from a fresh backoff. The wait holds the background
task as a timed retry does, so an ordinary handover between wifi and mobile data is covered; a
longer one outlives it and the app is suspended like any other silent app. After fifteen minutes the
conductor says unreachable through `onTimedOut`, because no player reading would. A
different network is a move, and makes the retry due at once (a fresh item, on the new interface)
for a mount that has not failed as well as one that has; HLS is left alone. The identity is the
path's first interface name, since a path has no network handle, so two wifi networks look the same
and a move between them falls back to failing and being retried. Not yet measured on a phone.

**The format nobody chose is Automatic, and it is the absence of a choice**: `format` is `nil`,
stored as no key at all, and `chooseMount` plays HLS where the station publishes it and MP3 where
it does not, never as a fallback. Every save used to write the format whichever setting changed,
so a stored `mp3` from before says nothing about a choice; `SettingsStore` forgets it once, behind
the `format_automatic_read` marker, and keeps any other format. Checked on the simulator by editing
the container's plist: restart `cfprefsd` (`launchctl kickstart -k
user/foreground/com.apple.cfprefsd.xpc.daemon` through `simctl spawn`) before reading the file or
writing it, or the file and the app disagree and the test proves nothing.

**A `deadair://` link proposes a station; it never switches to one.** Android's rule and the
desktop's grammar (`StationLink`, whose tests are theirs case for case). With no station kept, setup
opens straight on the field with the address in it. With one kept, a sheet asks over the app, and
the kept station, its session and whatever is playing stay until the new address has answered and
somebody has pressed Listen; "Keep the station I have" turns it down. A link naming the kept
station asks nothing. A user or password, in the link or inside its escaped origin, is refused.

**There is no in-app scanner, and that is deliberate.** Android scans the console's code with Google's
scanner, which needs no camera permission. On iOS any in-app camera needs `NSCameraUsageDescription`, a
prompt, and a new line in `PRIVACY.md` and the App Store's privacy answers. The console's code is a
`deadair://` link, and the system Camera already opens one in this app, so setup says to use it and
the app asks for nothing. Not yet measured on a phone: the simulator has no camera.

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
`admin`, the operator's verbs; nothing about hearing the station. In practice the credentials are the
operator's: a `listener` account is made only by signing in through an identity provider, which leaves it
with no password, and this app signs in with one. Request is drawn for any signed-in account for that
reason, and is verified with the operator's.

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

**Every operator call goes through `OperatorActions`, and its notice is drawn at the ROOT.** A 403
re-reads the roles and says the account is no longer the operator; a 403 that names a step-up
(`details.kind` or `mfa_required` in the challenge) says so instead and leaves the roles alone,
because the account still holds them. Android lost a refusal raised on a pushed screen, since its
collector lived on a screen that was not composed. Here every toast goes through one `Toasts`,
drawn as an overlay above the tabs, so whichever screen raised it, it is on top; a break that could
not be got ready to send says so the same way. `ensureRoles` runs at the root too,
so a role taken away since the last run is noticed before an operator control is drawn.

**Take off air arms, and lives only on the desk.** One press arms it and renames it; a second inside
five seconds fires; the arm forgets on its own and is never persisted, Android's `ArmedStop` and the
console's figure. Now playing keeps Skip and the lock screen's next button; the desk, reached from
Settings, holds Take off air, the hold, the air mode and the silence diagnosis, so the two stops are
on different screens. Measured on the simulator against the live station on 2026-10-02: one press
armed it and drained the bar, the arm lapsed after five seconds, and the station stayed on air.

**Verifying against the live station: look, never tap near a verb.** On 2026-10-02 a tap meant for
the host picker's Cancel landed on a persona row while the sheet was still sliding up, and recast the
live show for everybody listening; it was put back by hand. The app was doing what it should, since
one tap on a row recasts as on Android. The lesson is for whoever drives the simulator: a fresh
screenshot after every animation before any tap on a screen that acts on air, and on the forms that
replan or put the station on air, open and read and press nothing.

**The second factor is answered against the AUTHENTICATOR**, picked out of the challenge's factors,
never its first entry, and the three refusals that share one 401 are told apart by
`WWW-Authenticate`. Both are the desktop app's shipped bug.

```bash
apps/ios/Packages/DeadairCore/test.sh
swift build --package-path packages/sdk-swift -Xswiftc -warnings-as-errors
```

**Debug builds take `-start_tab` and `-start_page` launch arguments** (`AppModel.startTab`,
`PageRoute.start`): `-start_tab upNext|whatsOn|settings` opens on a tab, and `-start_page history`,
`scripts`, `desk`, `manage`, `addRecord`, `request`, `signIn`, or `track:<id>`, `album:<id>`, `artist:<id>`
opens that page pushed on Settings (pass `-start_tab settings` with it, or the page is pushed on a tab
nobody is looking at). They exist so a screen can be screenshotted on a simulator with
`simctl launch` and no tap at all, which is the only safe way to look at a screen that acts on air
(see the recast above). Release builds ignore both.

## What has been verified

`DeadairCore`'s tests pass, 412 of them on 2026-10-02, with warnings as errors, under both the Command Line Tools
and Xcode 26.6, and the single-flight test was shown to fail with the in-flight share removed. The
generated SDK compiles in Swift 6 mode with strict concurrency. The app builds for the iOS simulator
with no warnings, from the hand-written project file, on the first attempt.

Against the live station, on an iPhone 17 Pro simulator running iOS 26.5: the address check found
the station by name; the player read off air, then warming up, then the record with its artwork and
a moving playhead; MP3 and HLS both played, with the timings and titles above; stop dropped the
connection on both; the format picker greyed the two formats the station does not publish; and
audio went on with the phone locked.

Since then: the app has run on an iPhone SE (2nd generation) signed with a personal team; the
operator has signed in against the station from the simulator; and Now playing, Up next, What's on,
History, What it said, the record pages, Settings and the sign-in page were laid out against Android's
and screenshotted on the 17 Pro and SE simulators, most in both light and dark (2026-10-02). The host
picker, Manage, the plan form and setup were not looked at that way.

Not yet: CarPlay on a head unit or the simulator's CarPlay window, Siri starting a swiped-away app, the lock-screen tile's appearance on the phone, an interruption from a call, a reconnect
after a dropped stream, the background task running out, and the system Camera opening a console code.
