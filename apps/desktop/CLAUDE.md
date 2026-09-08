# The desk you can hear

`apps/desktop` is the station as a desktop application: a listener with a real player, and the
operator's console, in one window. The web console is the desk and deliberately does not play the
station; the Android app plays it and grew an operator remote afterwards. This is both from the
start, which is the only thing about it that is genuinely new.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md), and the client rules this app is subject to are in
[`docs/internals/playout.md`](../../docs/internals/playout.md) — `apps/android` is their other worked
example and is worth reading beside this file rather than after it.

**The first release targets macOS on Apple Silicon and nothing else.** Windows and Linux are later,
behind seams that exist from the first phase (`IStationPlayer`, `ISecretStore`) rather than as a
port to be attempted afterwards.

## Where it sits

**Not a pnpm workspace member, deliberately.** There is no `package.json`, so the `apps/*` glob in
`pnpm-workspace.yaml` skips it and turbo and the root `vitest.config.ts` never see it. A .NET
solution shares no task graph, no `dist` and no test runner with the TypeScript tree, so one CI job
of its own is cheaper and more honest than making it pretend. Same arrangement as `apps/android` and
`analysis/`. Build droppings go in the ROOT `.gitignore`, because that is the only one in the tree.

**Two projects and a generated third.** `packages/sdk-csharp` is the API client, generated;
`apps/desktop` holds everything else and references it by relative path, exactly as `:app` includes
`:sdk` next door. `Directory.Build.props` does NOT reach the SDK, which sits outside this directory
and carries its own properties.

## The SDK is generated, and a compile error is a generator bug

`packages/sdk-csharp/**` is emitted by `@contractkit/plugin-csharp` from the `.ck` contracts. Never
hand-edit it; `pnpm build:contracts` overwrites it and the `generated` CI job diffs it. The one
exception is `DeadairSdk.csproj`, which the generator writes once `ifAbsent` and never again — which
is why `scaffold` is off in `apps/api/contractkit.config.json` now that the file exists. Saying
`scaffold: true` there permanently would describe an intention the config does not have.

**C# that does not compile is fixed UPSTREAM**, in the ContractKit repository, with a test and a
changeset, and never here. That is the rule the Kotlin SDK arrived at the hard way — three of its
first four released fixes were compile errors — and the reason this one landed clean on first
contact is that the upstream plugin has an output test that actually runs `dotnet build` with
warnings as errors. **So this tree holds the generated project to the same bar**
(`TreatWarningsAsErrors` in the csproj, which is stated rather than inherited) instead of assuming
it.

**Compiling is one gate and DECODING is a different one, with no upstream test.** The fixtures in
`tests/MaroonedSoftware.Deadair.Sdk.Tests` are the shapes the services really produce, one per
branch, and they exist because a generator can be perfectly happy about a wire name that is wrong.
Two things they have already been worth:

- **`MfaRequiredResponse` is snake_case on the wire** — `challenge_id`, `expires_at`, `method_id` —
  because the contract carries `format(output=snake)`. The first fixture written here guessed
  camelCase from the C# property names and was wrong; the generator was right, and the web console
  reads `challenge.challenge_id` to prove it. Getting that backwards is precisely how the Kotlin SDK
  once failed sign-in with a missing-field error on code that compiled.
- **`/auth/token` sends a FORM, not JSON.** The contract declares
  `application/x-www-form-urlencoded` first and the generator uses the first declared mime, so the
  grant travels through `SdkHttp.Params` walking the record's JSON. It is invisible at the call site,
  which is why `TokenRequestEncodeTests` asserts the wire text rather than the object. This is the
  only place in the client where an ENCODE bug can fail sign-in against a server behaving perfectly.

## Four toolchain facts that are not preferences

**xunit v3 runs on the Microsoft Testing Platform, and the .NET 10 SDK deleted the VSTest path it
used to reach.** So `Microsoft.NET.Test.Sdk` and `xunit.runner.visualstudio` are NOT referenced —
adding either back produces "Testing with VSTest target is no longer supported". What selects the
runner is the `test` section of `global.json` and nothing else. The `TestingPlatformDotnetTestSupport`
property is the older opt-in for driving a platform project through VSTest on an SDK that still had
one; it is documented as unnecessary on .NET 10 and was measured here as insufficient as well, which
cost a pass to find out. A `dotnet.config` with a `[dotnet.test.runner]` section does nothing.

**An XML comment may not contain a double hyphen.** `Directory.Build.props` failed to load the first
time it was written, because a comment quoted a command-line flag. MSBuild reports it as
`MSB4024 ... could not be loaded`, naming the file and not the reason, from every project that
imports it. Name flags in prose here, not in punctuation.

**Analyzer CA1707 is off for `tests/**` and nowhere else.** A test name is a sentence and the
underscore is the break between the claim and the qualifier that earns it a test
(`DecodesAQuietStation_WhichIsAnOrdinaryAnswerAndNotAnError`). The Kotlin listener writes the same
names inside backticks, which C# does not offer. A public API with an underscore in it is still
wrong, which is why the suppression is scoped in `.editorconfig` rather than switched off globally.

**Central package management, and every `Avalonia.*` package moves together.** Avalonia's packages
are built as a set and mixing versions inside one build fails at run time rather than at compile
time, which is the expensive way to find out. `Directory.Packages.props` is the only place a version
is written.

## What the station does to a client

All of this is `docs/internals/playout.md` and applies here exactly as it applies to the phone. It is
repeated rather than referenced because every line of it is a way to break a station by accident.

**Connecting to a mount is what puts the station on air.** `playout.airMode` defaults to `audience`,
so the seconds after somebody presses play are warm-up — the lease, the first record, the encoder —
and a client that draws them as an error, or as a spinner that never resolves, is misreporting the
station's ordinary behaviour.

**Never probe the mounts to find out which exist.** A connection, however brief, is an audience for
the full five-minute linger, so a settings screen built that way would put a silent station on air
for five minutes. `GET /nowplaying` carries `mounts[]` for exactly this, and it is the only thing to
read for it.

**One User-Agent from every request** — audio, API and artwork. HLS listeners are counted per IP and
agent from playlist re-fetches, so a client sending two agents is two listeners and one sending none
is whatever the platform's default happens to be. It goes on in a `DelegatingHandler` on the one
shared `HttpClient`, never at each call site, because an interceptor cannot be forgotten by a new
caller. The player gets the same string: on macOS through `AVURLAssetHTTPUserAgentKey`.

**Stop must DROP the connection, never pause.** A paused live connection is still an audience to the
gate. This is the Android `LivePlayer` rule reached from the same direction.

## The player is the platform's own

**AVFoundation, not a bundled engine.** `AVPlayer` handles ICY MP3 and HLS natively, reconnects on
its own, and ships with the operating system, so there is no libvlc to bundle and no arm64 dylib
question to answer. `MediaPlayer.framework` gives the system Now Playing widget and the media keys,
which is the desktop's version of what `MediaSession` buys on Android — and the same rule applies to
the Next key: it is the OPERATOR's Skip, so it is registered only while the cached roles say `admin`.

`IStationPlayer` is the seam, and `PlaybackConductor` holds the policy above it (warm-up until the
first `Playing`, then backoff reconnects) so that neither the choice of engine nor the choice of
platform reaches a view model.

### What AVFoundation did on the first run

Measured against the live station on 2026-09-07 by `spikes/PlayerSpike`, which is why that program
is kept and is in the solution: it is how this is re-measured after any change to the shim.

**It plays both mounts, and the two are not equally quick.** MP3 reached `Playing` at about five
seconds, consistently, and HLS at between 0.2 and 1.5 seconds. That gap is worth knowing before
anybody tunes a spinner: five seconds of silence after pressing play is the ORDINARY case on the
default mount, not a slow station, and on an audience-gated station it is partly the station itself
waking up.

**AVFoundation is serviced by the MAIN thread's run loop, and this cost two wrong diagnoses.** In a
console host the player opened, reported buffering, and then sat there forever with no audio and no
error — which looks exactly like a broken player and is a host that never let it work. Two things
have to be true: something must pump the run loop, and it must be the thread the player was built
on. The first version pumped `[[NSRunLoop currentRunLoop] runUntilDate:]` and returned in a
hundredth of a second, because **a run loop with no input source attached does not wait**; the
second attached a timer and waited correctly, on a thread-pool thread, which is not the one that
matters. The fix in the spike is that nothing in it may `await`: a C# `await` resumes on the thread
pool, the main thread parks, the main queue is never drained, and the player stalls. An Avalonia app
runs a main loop already, so **the rule that survives into the app is that the player is built and
driven from the UI thread**, and `MacRunLoop.Pump` is for headless hosts and must never be called
from a GUI one.

**Whether stopping drops the connection is NOT established by a socket count, and an earlier version
of this file claimed it was.** The claim was written from a measurement that was really counting the
API client's keep-alive. What is actually true: **AVFoundation holds no audio socket in this
process** — `lsof` on the app's own pid shows none at all while the player reports rate 1.0, proved
with a standalone Objective-C program that opens no other connection — and the helper that does hold
it is not visible to `lsof` without elevated privileges. So there is no socket witness available
here, and the spike no longer prints one.

What the rule rests on instead: `replaceCurrentItemWithPlayerItem:nil` releases the item and its
loading, which is Apple's documented way to stop a live stream rather than suspend it, and pausing
demonstrably is not that. The honest end-to-end witness is the station's own listener count, which
lingers five minutes past the last listener by design — so confirming it means watching that count
fall six minutes after a stop, on a station nobody else is listening to.

The lesson is the one this file keeps relearning: a diagnostic that prints a plausible number is
worse than none, because it gets written down as a measurement.

**`AVURLAssetHTTPUserAgentKey` needs a deployment target of macOS 13**, which is why `build.sh`
passes `-mmacosx-version-min=13.0`. It is the only supported way to set the agent on the connection
that carries the audio; the older `AVURLAssetHTTPHeaderFieldsKey` trick applies to range requests
alone, so the request that actually streams goes out as AppleCoreMedia and is counted as a different
listener from the rest of the app.

## Avalonia 12, and four things that are not in any migration guide

**A custom `ThemeVariant` cannot be named as a string in XAML.** `RequestedThemeVariant="Carbon"` and
`<ResourceDictionary x:Key="Carbon">` both compile and then throw at startup — the type converter
knows the built-in light and dark pair and nothing else. Both have to be `{x:Static
themes:ConsoleThemes.Carbon}`. This costs two runs to find, because the second failure looks like the
first one coming back.

**`Avalonia.Diagnostics` has no Avalonia 12 release.** It stops at 11.3.20, so the developer tools
overlay is simply unavailable and asking for it fails the restore rather than degrading. Checked
2026-09-07.

**A `ResourceInclude` goes inside `ResourceDictionary.MergedDictionaries`**, not directly under
`Application.Resources`, and `TextBox.Watermark` is obsolete in favour of `PlaceholderText`.

**Avalonia's build-time telemetry task writes a file, and a sandboxed session cannot.** It fails as
an `MSB4018` stack trace out of `Avalonia.BuildServices.targets` with no mention of a sandbox, which
reads as a broken toolchain. There is no opt-out property in the targets file; the answer is to build
with the sandbox off, as with NuGet restore.

## The system's own now-playing display

**It only works from a bundled application.** A plain `dotnet run` has no bundle identifier, so macOS
has nothing to attribute playback to and the widget stays empty. That is a property of how the app was
launched rather than a fault, and it is one of the reasons `tools/macos/make-app-bundle.sh` exists.

**The next button is a statement about the ACCOUNT, not about the player.** A live mount has no next
track, so the system offers none by default; turning it on is what puts the operator's Skip on a
keyboard, and it is enabled only while the signed-in roles say `admin`. Pressing it runs the desk's
own skip rather than anything on the player, so a keyboard skip and a clicked skip cannot disagree
about notices or roles. Previous, seek and scrub are permanently disabled: a system that drew them
would be promising something the station cannot do.

**Pause and stop are the same command here**, and both drop the connection, for the reason `Stop must
DROP the connection` gives above.

## What the listener does

**The playhead refuses to guess.** `remainingMs` is absent whenever the station's decoder cannot say,
and the obvious fallback — the clock minus `startedAt` — measures when the station STARTED the record.
That leads what a listener is actually hearing by the encoder and client buffers, and drifts further
the worse their connection is. So `Playhead.Position` answers null and the bar draws nothing, because
a progress bar that is confidently wrong is worse than one that is absent.

**A failed poll keeps the last good reading and marks it stale.** Blanking a screen because one
request timed out throws away something true and still useful. It is the station's own rule read from
the other side: a failed reading of the listener count is "could not say", never zero.

**Settings are tolerant of a bad file, and that hid a real bug once.** `FileSettingsStore` treats an
unreadable file as an install with no preferences, which is right — the worst case is retyping a
station address, and refusing to start is worse. But `ThemeId` had no string converter, so a
hand-written file naming `"Carbon"` failed to parse, the tolerance swallowed it, and the app started
as though it had never been configured, taking the station address with it. Found by RUNNING the app
and noticing it opened no connection. The converter is on the enum now and a test asserts the file
reads as names; the lesson is that a deliberate catch needs a test proving the ordinary path through
it works.

## The session

**Listening is accountless and stays that way.** A session buys the `platform.view` reads and the
manage verbs; it buys nothing about hearing the station.

**Tokens live in the OS credential store**, behind `ISecretStore`, keyed by station origin. This is
the one place the desktop deliberately departs from the Android app, which keeps them in an
unencrypted DataStore file and says so: a desktop is more likely to be a shared machine, and the
Keychain is one `LibraryImport` file rather than three native integrations while only macOS is
supported. It uses the `SecKeychain*` family, which is deprecated and still present; the newer
`SecItem*` one takes a `CFDictionary`, and building one across P/Invoke is more native code than the
whole store.

**A refresh has THREE outcomes, not a token or nothing.** This was a nullable string until a test
asked what happens when the station is down during a refresh: the 5xx propagated out of the handler
and surfaced at whoever had triggered it, so a poll asking for the running order reported a failure
to exchange a token. "The session is over" and "the station could not be asked" want opposite
handling — one signs the operator out, the other changes nothing and hands back the caller's own 401
— and a null cannot tell them apart. `RefreshOutcome` is `Renewed`, `SessionEnded` or `Unavailable`.

**The refresh is single-flight, and that is not tidiness.** Refresh tokens are single-use and
rotating, and presenting a spent one revokes the whole family — so two pollers hitting 401 together
must produce one refresh, and the lock has to re-check whether the token it set out to replace is
still current after it acquires. **A session ends on a 4xx to the refresh and on nothing else**: not
a network failure, not a 5xx.

**Roles come from `GET /auth/session` and are a HINT.** They decide what is drawn; the API decides
what is allowed. A 403 refreshes them rather than being reported as a failure. The web console gates
nothing at all and lets every 403 through to the user, which is a defensible choice for a page that
is only ever opened by the operator and the wrong one for an app that is also a listener.

## Navigation

**The rail replaces rather than pushes.** A rail is not history, so pressing Desk after Library does
not leave Library on a stack. Detail pages, when they arrive, will push onto one.

**A destination says whether it needs an account, and the rail hides what an account cannot reach.**
Desk and History need none, because listening is accountless and somebody who heard a record twenty
minutes ago should not have to sign in to learn its name. Signing out while on a gated page sends
them back to the desk rather than leaving them looking at an empty screen with no explanation.

**Setting `DataContext` on a child re-scopes every binding on that element**, including `IsVisible`.
So a page whose visibility depends on the shell has to name the window's own DataContext explicitly:
`{Binding $parent[Window].((vm:ShellViewModel)DataContext).Navigation.IsDesk}`. Inheriting it looks
right, compiles, and fails at XAML load with a message naming the CHILD's type.

**A name that is both a property and a namespace resolves to the property.** `Navigation` and
`Notice` have both bitten this tree; the fix each time is a `using` alias rather than a rename, since
the property names are the ones the views read.

## The library and the voice

**Each tab fetches once, when it is first opened.** None of a catalog, a playlist list or a chart list
changes while somebody is looking at it, and the station rate-limits at a hundred requests per five
seconds — so these are reads on demand rather than polls. Only the records tab pages, because only it
can be long.

**Putting a playlist or a chart on air REPLACES the running order**, and what is on air finishes
first. It is the most consequential thing on either page, which is why the notice says what happened
rather than only that it worked. A chart answers with the status BEFORE its changeover and does the
work as a job, so the notice for one says it takes a moment.

**The voice page is four readings, not the console's eight tabs.** The four are the ones that answer a
question somebody asks of a RUNNING station: who is presenting, what did it say, what audio does it
hold, and what is being made. Voices, pronunciations, pads and topics are configuration rather than
observation and are left for later.

**A script row is one ATTEMPT rather than one segment**, which is the whole point of that endpoint: a
model that declined and the floor that covered for it are two facts, and collapsing them into one row
would hide the more interesting of the two.

**A production is cancellable in the states that are still being made, listed positively.** Naming the
states that CAN be cancelled rather than the ones that cannot means a stage added upstream is not
silently cancellable by omission.

## Settings

**The station's half is drawn from what it declares**, so a setting added there appears here with no
code: key, label, type, bounds and help all come off `GET /settings`. Nothing in this app knows what
any particular setting means.

**A setting is a STRING, and the client has to honour that.** Every layer of the station's
configuration holds text, so a switch travels as the word `true` and a number as its digits. Sending
a JSON boolean would be sending a shape the station does not store. The reading side matters just as
much: `true`, `1`, `yes` and `on` are all on, and anything unparseable takes the DECLARED DEFAULT
rather than falling to off, because a value nobody can read is a value nobody set. That default is a
small union rather than a string, so it is matched rather than stringified — `ToString` on it gives
`OfBoolean { Value = True }`, which parses as nothing.

**A secret is never prefilled**, because the station reports it as a configured-boolean and never as
a value. An empty box means leave it alone; sending an empty string would clear it.

**Only what changed is sent.** The endpoint takes a partial write, and sending everything back would
overwrite a value somebody else edited while the page was open.

**Appearance is this install's own** and never leaves it, which is why Settings is reachable with no
account: somebody who only listens should still be able to choose which console they are looking at.
The stored theme is applied before the window is drawn, so it does not open in carbon and repaint.

## The check-up

**Three readings, not one.** The check-up endpoint carries only the two signals nothing else exposes
— the loops and the catalog backlog — because everything else a health page shows is already on a
reading somebody is polling. So the page reads the check-up, the attention list and the activity feed
separately rather than asking the station to compose a verdict it has no business composing.

**A loop reports two timestamps and no verdict**, and the client must not invent one: a five-second
reconcile and a nightly sweep are both healthy, and no single threshold describes both.

**The feed and the attention list use different words for the same idea** — `info`/`warn`/`fault`
against `notice`/`warning`/`failure` — so the mapping to a severity is written out rather than
assumed to line up by name.

**A missing revision is not a failed read.** It means nothing stamped the build, which a development
tree and a hand-built image both are.

## The programme

**A slot's times are minutes from midnight and its days are a list**, because a slot recurs. Two
things follow that are easy to draw wrong. An end of 1440 is midnight at the FAR end of the day, and
formatting it as `00:00` produces a slot that appears to end before it starts. And the slot the
station is actually airing is not always the one the clock says: a hold keeps a broadcast past its
slot deliberately, which is why the ON AIR marker follows `airingSlotId` rather than the time.

The timetable is read-only for now. Editing wants dragging and resizing, and a wrong drop reschedules
a broadcast — the same order the running order's own edits arrived in.

## The running order

**The station REFUSES a move rather than clamping it.** A position the player already holds is not
quietly turned into the nearest legal one, which is right — doing something other than what was asked
is worse than refusing — and it means the client has to know where the movable region starts, or
every "send to the top" on a busy order comes back rejected. `MoveTarget` works out that floor: the
first item still `planned`. The move buttons answer null rather than an index when there is nowhere
to go, so nothing is sent.

**Undo is offered for a record and not for a segment**, because a dropped record is spliced out and
can be added back while a dropped segment is marked `removed` and stays that way. Offering it for
both would be offering something that cannot happen. The contract types the item's own `trackId` as a
string, since it is absent on a segment and on a record the catalog has never seen, while the
add-a-record input takes a `uuid` — so undo is offered exactly when that string parses, which is the
same set the station would take back.

**"Runs dry at" is arithmetic the client does.** The station sends durations, not a time, and an item
with no duration contributes NOTHING rather than a guess: an order that runs out slightly earlier
than predicted costs an operator an extra extend, and one that runs out earlier than promised is the
station going quiet. The twenty-minute warning threshold caught its own test fixture, which was
fifteen minutes long and therefore already short.

## The second factor, and the bug that taught it

**A challenge lists EVERY enrolled factor, in enrolment order, and only the authenticator can be
answered here.** Taking the first entry works right up until an account has an email or phone factor
enrolled before its authenticator, at which point the station refuses the code as `invalid_factor` —
and it refuses every code, forever, for that account. Filter by method, as the web console does.

**Three rejections arrive as one status, and the station names them in `WWW-Authenticate`.**
`invalid_grant` is a wrong code, `invalid_challenge` is a sign-in that has expired, and
`invalid_factor` is the client sending the wrong method id. Reporting all three as "that code was not
accepted" is what made the bug above so hard to see: the only message the operator could get was the
one that ruled out the actual cause, and it invited them to keep retyping a code that was correct.

**The lesson is about the message rather than the filter.** The filter was one line and the wrong
sentence cost the diagnosis. A client that cannot distinguish its own failure modes hands the person
in front of it a false lead.

## What is verified against a real station, and what is not

The listener half is measured against the live station: it plays, it polls, and the phases are in
`What AVFoundation did on the first run` above. **The operator half is not.** Signing in needs the
operator's own credentials, so the session rules — the single-flight refresh, the one replay, the
exempt token endpoints, a 4xx ending a session where a 5xx does not — are proved against a fake
station in `SessionHandlerTests` and `SessionManagerTests` rather than against the real one. That is
a deliberate limit rather than an oversight: the tests can produce two simultaneous 401s and a
rotation that answers without a new refresh token, and a live station cannot be asked to.

## Conventions

Four-space indent, file-scoped namespaces, `TreatWarningsAsErrors` everywhere. Tests are xunit v3 in
`tests/`, mirroring the source namespaces; the pure layer carries the coverage and there are no UI
tests, exactly as on Android.

**Words: pure state returns a `Message`, never a sentence.** Strings live in `Strings.resx` and are
resolved at the view edge. `Message.Text` is only for words the STATION sent — a silence remedy, an
attention row — which the client passes through verbatim and never rewrites.

**C# cannot check that a `switch` covers a closed hierarchy**, so `MessageResolver` ends in a
throwing default and a reflection test asserts every `Message` case has a resource key. That is
Kotlin's compile-time exhaustiveness bought at test time, and it is the one deviation from the
Android precedent that is a language limitation rather than a decision.

## Building it

```bash
cd apps/desktop && dotnet build -warnaserror && dotnet test
```

The native shim is not built by MSBuild and has to exist before the player will load:

```bash
apps/desktop/native/mac/build.sh
```

Its output is gitignored, so a fresh checkout has none and the player project's `None` item is
skipped by a `Condition` rather than failing the build — the failure comes when a player is
constructed, which is where the message can name the script.

To hear the station and watch the phases, against a real one:

```bash
dotnet run --project apps/desktop/spikes/PlayerSpike -- https://radio.deanhome.app 20
```

And the app itself:

```bash
dotnet run --project apps/desktop/src/MaroonedSoftware.Deadair.Desktop
```

It keeps its settings in `~/Library/Application Support/deadair/settings.json`, which is a different
file from anything to do with a session: signing out must not take the station address with it,
because somebody who signs out is still a listener. The session itself is in the Keychain.

To cut a release, run the `Desktop release` workflow with a version. It runs the same gates as the
ordinary build, then the bundle script, and archives with `ditto` rather than `zip` — a plain zip
loses the resource forks and symlinks inside a bundle and produces something macOS unpacks into an
app that will not launch.

To build something that can be double-clicked:

```bash
apps/desktop/tools/macos/make-app-bundle.sh
```

About 112MB, self-contained, and unsigned — so the first launch needs a right-click and Open.

**Publishing for a runtime identifier rewrites every `packages.lock.json` to name that RID**, and a
plain restore afterwards then fails in locked mode because no project declares one. CI restores
locked, so one packaging run breaks the next build — which is how this was found, by running the CI
sequence rather than by reading it. The bundle script passes
`-p:RestorePackagesWithLockFile=false -p:RestoreLockedMode=false` for that reason, and if a lock file
ever grows an `osx-arm64` line, `dotnet restore --force-evaluate` is what takes it back out.

Two publish flags are deliberately absent: `PublishTrimmed`, because the generated SDK reads JSON by
reflection and the trimmer cannot see it, and `IncludeNativeLibrariesForSelfExtract`, which is
incompatible with macOS and fails at RUN time with "Failed to create CoreCLR" rather than at
publish.

**In a sandboxed agent session, add `-m:1`.** MSBuild's parallel worker nodes connect over local
sockets, the sandbox refuses them, and the build hangs for exactly five minutes and then reports
`Build FAILED` with zero errors — which reads like a broken repository and is not one. NuGet restore
is refused the same way (`NU1301 ... Permission denied (localhost:PORT)`) even though the host is
reachable by curl, so a restore needs the sandbox off. Neither applies to CI.
