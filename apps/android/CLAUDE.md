# The listener

`apps/android` is the app somebody LISTENS to the station on, and `packages/sdk-kotlin` is the
generated client it talks through. It is a listener's app for anyone, and the operator's remote
when the signed-in account is the station's `admin`: the transport, the running order, the library
and a way to air something, which are the controls worth having in a pocket. The console is still
the desk — personas, plugins, settings and everything else that is laptop work stays there, and the
phone's controls are a SELECTION of the desk's rather than the desk shrunk. The rule that makes that
safe is below under the session: `manage` controls are drawn for a cached role and the API decides
every press.

Every paragraph records a measured failure and the fix that was chosen over the obvious one. Read
the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Where it sits

**A pnpm workspace member on paper only, deliberately.** Its `package.json` is a name, a version and
`private`, and it exists for one reader: changesets, which can number only workspace packages, and
which is how this app's releases are numbered. It has no scripts and no dependencies, so turbo finds
nothing to run and the install nothing to fetch, and the root `vitest.config.ts` globs for a
`vitest.config.ts` this directory does not have. Nothing else changed, and the reason is the one
`analysis/` has: a Gradle build shares no task graph, no `dist`, and no test runner with the
TypeScript tree, so one CI job of its own is cheaper and more honest than making it pretend. Two
consequences: the lockfile names it as an (empty) importer, and `.dockerignore` keeps the manifest
while dropping the rest, because the image's frozen install checks every member the lockfile names.
Its build droppings are in the ROOT `.gitignore`, because that is the only one in the tree.

**Two Gradle modules.** `:app` is this directory. `:sdk` is `packages/sdk-kotlin`, included by
path from `settings.gradle.kts` — a plain JVM library, not Kotlin Multiplatform, because the only
consumer is Android and Android consumes JVM libraries directly.

## The SDK is generated, and a compile error is a generator bug

`packages/sdk-kotlin/src/**` comes out of the `.ck` contracts in `apps/api/data/contracts` via
`@contractkit/plugin-kotlin`, exactly as `packages/sdk` does for the console. **Never hand-edit
it**: `pnpm build:contracts` overwrites it, and CI regenerates it and fails on anything that moved.
To change a shape, change the contract.

**Kotlin that does not compile is fixed UPSTREAM**, in the ContractKit repository, with a test and
a changeset — never here. The generator's own README said its output had never been put through a
Kotlin toolchain, and the first attempt found two bugs in an hour: a `/*` in contract prose opened
a nested comment that swallowed the rest of a file (Kotlin block comments NEST, so escaping `*/`
alone is not enough), and a default against a named `enum` contract came out as its wire string
rather than the enum member. Expect to find more, and expect them to be reported nowhere near the
text responsible.

A third turned up the first time the output was DECODED rather than compiled, which is a different
gate and catches a different class of bug: a contract's `format(output=snake)` never reached a
`@SerialName`, so `AuthenticationTokenIssued` was emitted with an `accessToken` property against a
station sending `access_token`, and the first real sign-in failed with a `MissingFieldException`
naming three fields and nothing about the casing that renamed them. `AuthTokenDecodeTest` is that
gate, kept.

All three are fixed in `@contractkit/plugin-kotlin@0.1.2`, which is the floor this repo pins — 0.1.0
cannot produce Kotlin that compiles, and 0.1.1 cannot produce Kotlin that signs in.

**`NowPlayingDecodeTest` is not testing generated code for its own sake.** A generator can be
perfectly self-consistent and still be wrong about the contract, so those fixtures are the shapes
`NowPlayingService` actually produces, one per branch it has.

## Three toolchain facts that are not preferences

**The app takes AGP's built-in Kotlin and cannot take anything else.** AGP 9's new DSL is on by
default and `org.jetbrains.kotlin.android` cannot be applied beside it — it casts the extension to
a type the new DSL no longer produces and fails at plugin application. That is also why `:sdk`
applies `org.jetbrains.kotlin.jvm` with NO version: built-in Kotlin puts the plugin on the
classpath at a version Gradle reports as unknown, and asking for a specific one is refused outright
rather than resolved.

**`compileSdk` is 37 because AndroidX requires it**, not as a preference, and the minor is part of
the coordinate now (`compileSdkMinor = 2`, for `android-37.2`).

**`mipmap-anydpi-v26` keeps its version qualifier and lint is wrong about it.** Lint's
`ObsoleteSdkInt` says the qualifier is unnecessary at `minSdk 26`; without it AAPT does not resolve
`@mipmap/ic_launcher` at all and the build fails at resource linking. That one check is disabled in
`app/build.gradle.kts` at the point of the claim.

## What the station does to a client

**Connecting to a mount is what puts the station on air.** `playout.airMode` defaults to
`audience`, so a quiet station is quiet because nobody is listening, and the first seconds after
connecting are WARM-UP rather than a fault — the lease, the first record, the encoder. A client
shows that as warming up, never as an error and never as a spinner that looks stuck.

**Off air, the running order is a synthesised answer rather than a 404, and what marks it is the
empty NAME.** `GET /director/air/order` answers `{ name: '', mode: rotation, onEnd: extend, items: []
}` when nothing is on, because a console draws an empty order and the operator puts something on.
The trap is the items: a real broadcast that has simply run out of records also has none, and it
still has a name, a brief and a host, and is still a thing to recast or replan. Keying "nothing on"
to `items.isEmpty()` alone therefore hid those controls at exactly the moment they were wanted —
measured, between two programmes. `BroadcastUiState.nothingOn` reads both.

**Never probe the mounts to find out which exist.** A connection, however brief, is an audience for
the five-minute linger, so probing five formats puts a silent station on air and holds it there.
`GET /nowplaying` carries `mounts[]` for exactly this reason; read that.

**The poll runs at two speeds, and what the slow one buys is not what it was expected to buy.**
`WhileSubscribed` already stopped `/nowplaying` when nothing collected it, which covers a
backgrounded app with the player stopped and covers nothing about the case that actually costs a
listener: an hour of listening with the phone in a pocket, where the poll is right to run and ran
at three seconds, twelve hundred requests, none of them drawn anywhere. So a collector that is
SHOWING the readings to somebody takes them through `NowPlayingRepository.watched` and gets three
seconds; everything else gets thirty.

The argument for it was that each of those requests wakes a radio the audio's own buffered bursts
would otherwise let idle. **Measured on a Pixel 8 Pro, that argument is wrong**, and it is recorded
here so nobody makes it again: two twenty-minute screen-off runs on wifi, this branch against its
base, put Wi-Fi sleep time at 97.0% BOTH ways, with Rx time within 0.3% and Tx within 2.1%. The
stream is ~9.6 MB a minute and never lets the radio idle in the first place, so the poll rides a
connection that is already up and costs almost nothing in radio time. Whole-device drain came out
2.77 mAh/min on the base and 2.99 on this branch — the wrong way round, and noise: the window is
uncontrolled and the power model attributed CPU and wakelock differently between the two runs.
What the same runs DID show is CPU: 21.4 s/min of app-process CPU on the base against 17.5 here,
18% less, with total CPU 11% lower, which is the twelve hundred TLS requests and JSON decodes not
happening. So the honest case for the slow cadence is CPU, one-tenth the requests against the
station, and one-tenth the lines in its log — not the radio. Whether a low-bitrate mount on
cellular, where the audio really is bursty, behaves differently is untested; do not assume it.
The lock screen is not left to that clock: `NowPlayingGate` publishes on the ICY title, which is
the encoder saying the record changed and arrives on the audio's own schedule, and a change with
nothing held asks the station for a fresh reading rather than republishing one taken up to half a
minute ago. Two things fall out that are easy to get wrong. The gate's hold is the buffer MINUS
the reading's age, because "the listener is `bufferedMs` behind the poll" stops being true the
moment the poll is slower than the buffer. And the display being lit is itself a watcher —
`PlaybackService` registers for `ACTION_SCREEN_ON`/`OFF` and `PlaybackConductor` subscribes to
`watched` while it is on and playing — because the lock screen, the shade and a car's screen are
drawn by other processes out of the media session, and none of them is a collector this app can
count. What stays coarse while the display is off: HLS, which carries no ICY at all, and a sleep
timer armed for the end of a record that the operator then SKIPS, which fires up to thirty seconds
late. Both were accepted knowingly; neither is ever what somebody is looking at while it is wrong.

**Giving up on the stream means stopping, not standing down.** `ReconnectPolicy` has always had a
five-minute budget so a listener who walked away from a dead station does not come back to a dead
battery, and for as long as it merely stopped RETRYING it did not buy that: ExoPlayer leaves
`playWhenReady` standing through a failure, which is what everything else in this app reads as
"somebody is listening". A player still wanting to play is a notification still offering Stop and,
expensively, `PlaybackConductor`'s poll still asking the station what is on. The poll backs off only
when the POLL fails, so the bad case is a mount that has lost its source while the API answers
normally: retries end after five minutes and the requests do not end at all. The budget running out
now calls the same `stop` the audio-focus cases use.

**HLS listeners are counted per IP and User-Agent**, from playlist re-fetches inside a 15-second
window. So there is one agent string (`UserAgent.VALUE`), and it reaches every request from one of
two places: an interceptor on the shared OkHttp client, which the SDK and the image loader both go
through, and the one `DefaultHttpDataSource.Factory` the playback service builds for ExoPlayer AND
for the media session's artwork loader. The interceptor rather than a header merged in by each
caller, because the image loader was sending `okhttp/4.x` for months and nothing said so; and the
session's bitmap loader given the same factory, because its default used the platform stack under
its own agent, which was a second listener for one request every time the record changed. Two
phones behind one NAT count as one listener — known, and accepted.

**The notification's Stop is a relabelled pause, and Android 13+ ignores the label.** `LivePlayer`
maps pause onto stop, and `LiveNotificationProvider` gives the notification's play/pause action a
stop glyph and the word Stop. From Android 13 the system draws its media control from the session's
playback state, not the notification's actions, so it shows its own pause glyph while playing; that
glyph stops (measured: the session reads `NONE` afterwards, not `PAUSED`). Withdrawing
`COMMAND_PLAY_PAUSE` so the system would draw stop instead is the obvious fix and the wrong one: a
headset's pause key arrives as that same command and would do nothing.

**A media button pressed while the app is NOT running needs two pieces, and one of them is in the
manifest.** Getting into a car and pressing play on the wheel is the moment somebody most wants a
radio, and it is exactly when this app is least likely to be running: `onTaskRemoved` stops the
service when nothing is coming out of it, so a swipe leaves nothing to press. `MediaButtonReceiver`
in the manifest is what wakes the service, and `MediaSession.Callback.onPlaybackResumption` is what
answers it with something to play. Both, or neither works — the receiver alone starts a service with
no items and the callback alone is never reached. Measured with the process genuinely gone (`am
kill-all` after swiping the task away, because a foreground service survives `am kill`): before, the
key did nothing at all; after, it starts the process and the stream. What it resumes ON is one item
at position zero, because a live stream has no position and no queue — the easy version of a problem
most players find hard.

**The Quick Settings tile is a press, not a second player.** `StationTileService` drives the
session through a `PlayerConnection` like the screen does, so it cannot drift from the Play button.
Three things about it were measured on the emulator (API 36) rather than assumed. A press starts the
playback service in the foreground with the app's process gone: System UI grants the app a 15-second
allowance for exactly this (`ActivityManager` logs `Background started FGS: Allowed` with
`tempAllowListReason:<tile onclick>`), which is why a tile is not the background-start problem it
looks like. A press sent while the shade is CLOSED never arrives (`cmd statusbar click-tile` then
logs "Managed to get click on non-listening state" and drops it), so a test has to
`cmd statusbar expand-settings` first or it measures nothing. And the press is carried out in a
process-lifetime scope rather than the tile's, because the tile is bound only while the shade is
open and closing it can tear the tile down in the second the playback service takes to bind. With
no station kept the tile is `STATE_UNAVAILABLE`, which the system greys and sends no press to, so
there is no "open the app" path to get wrong. The tile cannot ask for `POST_NOTIFICATIONS`; it leans
on the media session's exemption. `play/README.md` names it among the start surfaces.

**A head unit's next button is the OPERATOR's Skip, and getting it drawn took two facts that are
not obvious.** ExoPlayer offers `COMMAND_SEEK_TO_NEXT` only when there is a next ITEM, and a live
stream is one item for as long as it plays — so the command was never in the set `LivePlayer`
subtracts from, and withdrawing less from nothing yielded nothing. It has to be ADDED. And
`ForwardingPlayer` hands its listeners to the wrapped player, which fires
`onAvailableCommandsChanged` for changes to ITS commands and knows nothing of the subtraction on
top, so a session told once at construction believed that answer forever; `LivePlayer` keeps its own
listener list and announces the change. Both were measured against `dumpsys media_session`, whose
`actions` bitmask is the honest answer to "would a car draw this button" (bit 5 is skip-to-next).

**The button is offered only while the account is the operator, and that is the whole of the
safety.** A listener's head unit draws nothing rather than a button that would 403, which is the
same argument every other withdrawn command rests on. What it does NOT solve, and what was accepted
knowingly: the same physical control means "next track" in every other app, so a passenger reaching
for it cuts the record for everybody listening, with no second press to think in. The screen's Stop
arms for that reason and a steering wheel cannot. It is also not gated on there being anything to
skip — the screen's Skip is, because it has the transport reading in front of it, and the playback
service deliberately collects none of that.

**The home-screen widget is four rules, and three of them were measured the hard way.** A widget is
not a process: what the launcher shows was drawn by one that may be long gone, and it redraws when
Android says so. So `WidgetFeed` keeps a snapshot in its own DataStore file and the widget draws
that. **It takes `NowPlayingRepository.heard`, never `state`** — `state` is `WhileSubscribed`, so a
process-lifetime collector there would hold the station's poll open for the life of the app, which
is the one thing that class exists not to do. `heard` is a passive tap: it carries whatever the
screen or the playback service is already asking for and is silent otherwise, so under the default
setting a phone with nothing playing and the app closed asks the station nothing at all. That is the
live wallpaper's rule for the live wallpaper's reason, and `updatePeriodMillis="0"` is the same
sentence in the provider XML. **While playing it takes the gate's copy rather than the poll's**,
because `NowPlayingGate` holds a moved record until the audio carrying it has reached the listener
and a widget drawing the raw poll would contradict the notification beside it. Whether the station is
ANSWERING is still the poll's to say even then, or one failed request left "Can't reach the station"
over a record that was playing perfectly well. And **playing or stopped is REPORTED by
`PlaybackConductor`, never observed**: a widget holding a `MediaController` would keep
`PlaybackService` alive on behalf of a picture, and a process that died reports nothing, which is
correct, because a foreground service that was playing would still be alive.

**Three things about Glance that a Compose UI habit gets wrong, each measured on the emulator.** A
composition runs inside a WorkManager job, so a suspend in `provideGlance` that never returns is an
ANR (`No response to onStartJob`) rather than a blank widget: it waits for this app's own state with
a deadline and draws what it has. A redraw likewise suspends until that job has run, so the feed asks
for drawings through a conflated channel rather than awaiting them. And **hydration asks for no
drawing at all** — what is on disk is exactly what the launcher is already showing, and asking there
started a composition from inside `Application.onCreate` every time anything started the process,
which was killed with `failed to complete startup` before it ever drew anything.

**A Glance session recomposes; it does not call `provideGlance` again.** There is one session per
widget, so updating a widget whose session is open re-runs only the composition — a composition built
from values captured before `provideContent` therefore produces identical output for ever. The
station was stopped and the widget went on showing the record and a Stop button. The state is
COLLECTED inside `provideContent`, which is what makes a recomposition mean anything.

**A press from a widget is the only controller there is, and that broke `pressStation`.** It released
its controller the instant after `play()`, which only SENDS the command; a `MediaSessionService`
whose last controller unbinds while the player is still IDLE stops itself, so the command landed on a
service that was already dying — the session went BUFFERING and was destroyed 30ms later. The Quick
Settings tile never showed this because it keeps a connection of its own for as long as the shade is
open. The press now holds the controller until the player has left IDLE. A widget click is on the
background-start exemption list, as a tile press is: `Background started FGS: Allowed`, measured with
the app in the background.

**The widget's Skip arms, and the car's cannot.** `apps/android` gives the operator three Skips now
and they are not the same control: the screen's has a transport reading in front of it, the head
unit's has neither a reading nor a second press to think in and was accepted that way, and the
widget's has a target the size of a thumb on a surface that collects stray presses in a pocket. So it
arms on the first press and says so, and forgets after the screen's own `STOP_ARMED_MS` — an armed
Skip left sitting there is the bug it exists to avoid, from the other end. The armed flag is the one
piece of widget state deliberately not persisted.

**Android Auto's library holds exactly one item, the station, and must never hold a second.**
`PlaybackService` is a `MediaLibraryService` for Auto's sake: a root folder of radio stations with
the station in it, answered from the kept settings. Two things about it look like room to grow and
are not. A second item (one per format, say) gives the player a real next item, and a head unit a
"next" that is not the operator's Skip, which is the paragraph above undone. And the entry carries no
URI: a browser in another process hands back only the `mediaId` when somebody taps it, so
`onAddMediaItems` resolves it through the same `resumptionItem` a media button uses, which is also
what a voice search with no id at all resolves to. The library never learns which mounts exist by
connecting, for the reason every other screen does not.

## The session, and the one rule that is not obvious

**Listening is accountless and stays that way.** A session buys the `platform.view` reads and
nothing else, which is why sign-in is optional, last on the settings screen, and says so in its own
copy. The credentials are the operator's: nothing in the API creates a `listener` account, and
onboarding writes only the `admin` tuple.

**The refresh is single-flight, and that is not tidiness.** The station's refresh tokens are
single-use and rotating, and presenting a spent one revokes every token descended from that sign-in
at once. Two pollers meeting the same expiry is the ordinary case with more than one signed-in
screen, so `SessionManager.refreshed` takes a lock and, inside it, checks whether the token it set
out to replace is still the current one — if it is not, somebody else already refreshed and their
answer is the good one. Taking a second turn there is exactly the replay the station treats as
theft.

**A session ends on a 4xx to the refresh and on nothing else.** Not a network failure, not a 5xx: a
tunnel reconnecting or a phone changing cell would otherwise sign the operator out several times a
day, and a station having a bad minute says nothing about whether a session is still good.

**Roles come from `GET /auth/session`, are cached beside the tokens, and are a HINT, never a
gate.** The JWT carries no roles and the token response's `scope` is empty, so that one read is the
only way a phone can learn whether to draw an operator control rather than draw it and be told 403.
`SessionManager.ensureRoles` asks once per process for the session on disk (from a
`LaunchedEffect(session)` at the root, so it runs on a cold start and after a sign-in and not on a
rotation), `refreshRoles` is what a 403 on a control calls, and a 403 on the roles read itself is
stored as NO roles — a cache saying `admin` about an account the station has just refused is the
one state the read exists to correct. The API decides every operation regardless; a control drawn
on a cached role can still be refused, and the code that draws it must cope.

**Tokens live in a second DataStore file (`session`), not beside the settings in `listener`.**
Different lifetime — cleared on sign-out and on a station change, never on a format change — and a `clear()`
there must not be able to take the station address with it. They are not encrypted at rest:
`security-crypto` is deprecated, the file is app-private, `allowBackup="false"` and
`data_extraction_rules.xml` keep it off the network, and anything with the reach to read
app-private storage can read a keystore-wrapped copy too. That is a real limit, and `PRIVACY.md`
states what is kept rather than implying more.

## Signing and release

**The upload key is not in this repository and must never be.** It lives at
`~/keystores/deadair-upload.jks`, named with its passwords by four `deadair.upload.*` properties in
`~/.gradle/gradle.properties`; `*.jks` is gitignored so a stray copy cannot be committed. Every one
of those properties is OPTIONAL in `app/build.gradle.kts`, and that is load-bearing rather than
tidy: CI holds no key and still has to configure and build, so an absent key leaves the release
type unsigned instead of failing. Losing the key is unrecoverable — the published app can then only
be replaced under a new application id, not updated — so it is backed up with the properties file,
not on its own.

**`versionCode` is `git rev-list --count HEAD` and is not edited by hand.** Play refuses a code it
has already accepted and the usual way that goes wrong is a human forgetting, so the number is a
fact about the tree rather than a step in a checklist. `versionName` is a decision rather than a
fact, and is made in a changeset: changesets bumps `package.json`, `pnpm release:version` copies the
number into `app/build.gradle.kts`, and the build job's `pnpm release:version --check` fails when a
hand edit moved one copy without the other. The changelog is `CHANGELOG.md` beside it, written from
the same changesets. A shallow checkout answers 1, which is why CI's bundle is unsigned AND unuploadable, and
neither matters for something built only to prove R8 still works.

**CI builds `bundleRelease` for R8's sake alone.** Minification is the one part of this build that
breaks without a source change — a dependency arrives, nothing keeps its reflection, the
serializers are stripped — and it fails at DECODE on a phone rather than at compile on a runner.
The release path is verified on every push that touches the listener or its SDK for that reason;
`.github/scripts/changes.sh` decides which pushes those are, and fails open when it cannot tell.

## Conventions

Kotlin official style, 4-space indent, files named PascalCase after the class they hold. The
repo's dot-notation file rule is for TypeScript and stays there. **Prettier does not see any of
this** — it has no parser for `.kt`, `.kts`, `.toml` or `.properties` — but it does check `.json`
and `.yml`, so keep configuration out of those two formats here.

**Navigation is Navigation 3, and it arrived with the detail pages rather than before them.**
Three tabs and a settings flag were an enum and a `when` for as long as that was all there was, and
a library then would have been a dependency plus a second place for the answer to live. A record
page reached from a history row, an album behind it and an artist behind that is a back stack
whether or not anything calls it one. Nav3 is the shape this tree already prefers: the stack is a
plain list of values that state holds and the display observes, keys are typed and serialisable
rather than route strings to be parsed, and predictive back comes from `NavDisplay` rather than
from wiring. Two rules fall out. **Every `Destination` is registered in `NavConfiguration`'s
polymorphic module**, because the stack is saved as a list of the `NavKey` interface and a
subclass it cannot name saves fine and fails to restore. And **the tabs are not destinations**: the
bottom bar is state inside the `Home` entry, so back from a tab returns to Now playing rather than
unwinding a history of taps, which is what Android guidance asks of a bottom bar. Setup is chosen
above the stack from `station == null`, or from a `deadair://` link's proposal, and is never pushed,
so it is not a place back can reach.

**A `deadair://` link proposes a station; it never switches to one.** The desktop's grammar exactly
(`StationLink`, whose test is the desktop's cases one for one), so the console's one link opens
whichever app is installed. The link fills the setup field and nothing else: the kept station, its
session and whatever is playing stay until the new address has answered Check and somebody has
pressed Listen, and "Keep the station I have" (or back) turns it down having changed nothing. A link
naming the station already kept just closes the question. It is offered only after the settings
have been read, because a link that LAUNCHED the app arrives before them, and not again on a
restore, because the launching intent is still attached after a rotation. A user or password in a
link is refused, including one smuggled inside the escaped origin: a link names a place, never a
way in.

**A notice raised by a pushed screen is lost unless that screen collects it.** `OperatorActions`
publishes into a `SharedFlow` with no replay, and `NavDisplay` composes only the entry on top, so
the collector on `Home` is not running while a pushed screen is showing. A refusal raised there was
posted to nobody: the operator watched a button do nothing. Every screen that can start an operator
action therefore has its own `SnackbarHost` and calls `ShowOperatorNotices`, and a screen that
succeeds pops afterwards rather than trying to say so on the way out — a snackbar shown to a Home
that is not composed yet is the same bug from the other end.

Pure logic — URL resolution, mount selection, the playhead projection — stays free of `android.*`
imports so plain JVM unit tests cover it. There are no instrumented tests and none are wanted.

**Words: pure state returns a `Message`, never a sentence.** The state classes that decide what a
line says (`NowPlayingUiState`, `StationEntryState`, `AccountState`, `WhatsOnUiState`, the two
clocks) answer with a value from `ui/text/Message.kt` — `Message.OffAir`, `Message.Listeners(n,
format)`, `Span.Hours(1, 30)`, `AiredLabel.Yesterday(clock)` — and the JVM tests assert on that
value. The words live in `res/values/strings.xml` and nowhere else, and `Message.resolve()` at the
Compose edge is where they are looked up, with the plurals and the twelve- or twenty-four-hour clock
(`LocalUses24HourClock`, provided once at the root from the phone's setting). The resolver's `when`
is exhaustive, so a message without a string is a compile error rather than an English fallback.
`Message.Text` carries words the STATION sent — a title, a credit, a block's label — and is never
used for app copy; the moment it is, that string cannot be translated and nothing will say so.

```bash
cd apps/android && ./gradlew :sdk:build :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```
