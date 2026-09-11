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

**A pnpm workspace member on paper only, deliberately.** Its `package.json` is a name, a version and
`private`, there so changesets can number this app's releases, and it holds no scripts and no
dependencies: turbo finds nothing to run in it and the root `vitest.config.ts` nothing to test. The
`.dockerignore` keeps that one file and drops the rest of the directory, for the reason
`apps/android/CLAUDE.md` gives. A .NET solution shares no task graph, no `dist` and no test runner
with the TypeScript tree, so one CI job of its own is cheaper and more honest than making it
pretend. That job runs on macOS at roughly ten
times an Ubuntu minute, so it runs only for a push that touches `apps/desktop` or
`packages/sdk-csharp` (`.github/scripts/changes.sh`). Same arrangement as `apps/android` and
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

## Avalonia 12, and five things that are not in any migration guide

**`ExtendClientAreaChromeHints` was REMOVED.** The window runs under the title bar with
`ExtendClientAreaToDecorationsHint` plus `ExtendClientAreaTitleBarHeightHint`, and the drag region is
whatever carries `WindowDecorationProperties.ElementRole="TitleBar"` — the sidebar's top strip. It is
worth knowing that `WindowDecorationMargin` reads as zero in a headless render, so a layout that
positioned itself from it would differ between what is drawn and what is looked at; the 80px the
traffic lights need is written down instead.

**A custom `ThemeVariant` cannot be named as a string in XAML**, and the app no longer has one: it
asks for `ThemeVariant.Default` and the theme dictionaries are keyed by the BUILT-IN `Light` and
`Dark`, which are ordinary strings. The rule survives for anyone reintroducing a variant of their own
— `RequestedThemeVariant="Whatever"` and `<ResourceDictionary x:Key="Whatever">` both compile and
then throw at startup, and both have to be `{x:Static}` — and it is why the built-in pair is the
cheaper answer.

**`Avalonia.Diagnostics` has no Avalonia 12 release.** It stops at 11.3.20, so the developer tools
overlay is simply unavailable and asking for it fails the restore rather than degrading. Checked
2026-09-07.

**A `ResourceInclude` goes inside `ResourceDictionary.MergedDictionaries`**, not directly under
`Application.Resources`, and `TextBox.Watermark` is obsolete in favour of `PlaceholderText`.

**Avalonia's build-time telemetry task writes a file, and a sandboxed session cannot.** It fails as
an `MSB4018` stack trace out of `Avalonia.BuildServices.targets` with no mention of a sandbox, which
reads as a broken toolchain. There is no opt-out property in the targets file; the answer is to build
with the sandbox off, as with NuGet restore.

## Plugins

**The app loads plugins, and the only thing one can be is somewhere else to play the station.** A
plugin finds devices and hands back an `IStationPlayer` per device; it contributes no UI, references
no Avalonia, and never learns what a phase means. `apps/desktop/plugins/bluos` is the first and the
worked example, and its own measurements are in `Plugins: BluOS` below.

**Bundled plugins load through the same path a third-party one does, and that is the point of the
`BundledPlugin` item in `Directory.Build.targets`.** It becomes a project reference that is built and
never compiled against, plus a copy of the plugin's whole output under `plugins/<id>/`. If the app
could name a type from a plugin it ships, the bundled one would work through a path nothing else uses
and the third-party path would rot unnoticed. The PUBLISH copy is a second target on purpose: publish
assembles its own directory and carries nothing the build put in the output one, so without it the
app bundle ships with no plugins at all — which a successful build does not reveal.

**A plugin csproj needs two properties that look like boilerplate and are not.**
`EnableDynamicLoading` is the SDK's own switch for a library that is loaded rather than referenced:
without it a class library leaves its packages behind and writes no `deps.json`, which is the file
the loader's resolver reads. `IsRidAgnostic` is needed because `Directory.Build.props` declares
`RuntimeIdentifiers` for the whole tree, which stops the SDK treating any project as
runtime-agnostic — and the app's self-contained publish then pushes its `RuntimeIdentifier` and
`SelfContained` down into every plugin and copies an entire runtime pack into each one's folder.
With both, the BluOS plugin's folder in the bundle is 108KB.

**The contract reference is `Private="false"`, and the loader has a shared-assembly list, and the two
are guarding the same thing.** A type is identified by its assembly AND the context that loaded it,
so a plugin holding its own copy of the contract implements an `IOutputTargetProvider` that is not
the one the app asks for. What that failure looks like is a message saying a type does not implement
an interface it visibly implements, with nothing wrong in any line of code involved. `PluginLoadContext`
answers `null` for the contract before consulting its resolver, which sends the runtime to the app's
own copy. `PluginLoaderTests` proves it by putting a copy of the contract beside the plugin on purpose.

**Load contexts are not collectible, deliberately.** An unload takes effect only once nothing anywhere
holds a reference, and a device player is exactly what a subscription or a pending request keeps
alive, so a collectible context would usually fail to unload while reporting nothing. Reconfiguring a
plugin disposes the instance and builds another from the same context, which is what an operator
needs; replacing the plugin's CODE means restarting the app.

**The manifest is a `plugin.json` beside the assembly rather than an attribute, and the ordering is
why.** The compatibility check has to happen BEFORE the assembly is opened or it can be defeated by
exactly the assembly it exists to keep out, and a disabled plugin's name and settings have to be
drawable with nothing executed.

**Bundled plugins are on unless somebody turns them off; plugins in
`~/Library/Application Support/deadair/plugins` are off until somebody turns them on.** Shipping one
is the decision to have it. That default produced the one real bug of the whole exercise: an absent
entry in the settings file is "nobody has said", not "disabled", and reading it as the latter meant
that saving a bundled plugin's configuration wrote `enabled: false` and switched it off in the same
breath as a change the operator did mean.

**A plugin gets its own `HttpClient` and never the station's.** The one-client rule this app is
otherwise strict about exists to be counted as a single LISTENER; a plugin talks to a box on the
local network, which is a different listener by design and must never be handed the station's bearer
token. Its timeout is infinite and every plugin request carries its own deadline, because a client's
timeout cannot be changed after its first request and no single number serves both a long poll and a
quick command.

**There is no `secret` config field type.** A secret must not go in the settings file, which means a
text-keyed credential store and a Keychain that can hold something other than a session: real work
for a plugin that does not exist. A plugin declaring one is refused with the type named, which is
honest; drawing it as a text box would put a password in a JSON file in somebody's home directory.

## Plugins: BluOS

**Measured against the Office M10 V2 on BluOS 4.16.22, 2026-09-08**, by
`plugins/bluos/spikes/BluOsSpike`, which is kept in the solution for the reason `PlayerSpike` is:
it is how this is re-measured, and half of what it tells you comes from a firmware that moves under
everybody. Read [now-playing-displays](https://github.com/robert-dean/deadair/blob/71e431d4/docs/todo/now-playing-displays.md)
first; it is the earlier probe of the same amp and it closed the DISPLAY half of this permanently.

```bash
dotnet run --project apps/desktop/plugins/bluos/spikes/BluOsSpike -- https://radio.example.com
```

**A player handed a mount reports that mount, and this corrects the earlier probe's biggest gap.**
`/Play?url=` produces `service=https` and `streamUrl=https://radio.example.com/live.mp3`, the bare
URL, from the moment it is asked rather than from the moment it plays. The probe had only ever seen
a `streamUrl` for a station added through the controller app, where it arrives prefixed
(`TuneIn:https://…`), so `BluOsPhase.Match` looks for the mount INSIDE the value and both readings
answer `Ours`. The phase table's "did not say" row survives as a defensive one: reading silence as
"not ours" would report a player that IS playing the station as stopped.

**`pause` does not mean somebody pressed pause.** When the station's stream stopped arriving the
M10 went to `pause` with `secs` frozen, not to `stop` — so the word covers a hand on a remote and a
stream that died, and nothing on this side can tell them apart. Both are `Stopped` here, which is
right for both: the conductor's answer to a stop nobody asked for is to try again, which is what the
second case wants and is harmless in the first.

**Warm-up is about seven seconds and it is all `connecting`.** Six seconds of `connecting`, one
`stream` with `secs=0`, then `secs` climbing. On an audience-gated station those seconds ARE the
station — the lease, the first record, the encoder — which is why the plugin reports `Opening` and
`Buffering` through them and never a failure.

**A long poll returns at its timeout with the same etag, and `secs` is not part of the etag.** Sixty
seconds in, the position had gone from 12 to 73 and the tag had not moved. So a long poll that
answers nothing new is the ordinary case, not a fault, and the warm-up stretch has to be polled
plainly: the transition that matters there is `secs` leaving zero, which by construction will not
wake a long poll.

**`/Play` against the URL already playing really is inert**, as the probe found: `secs` kept
climbing 75 → 78 with no reconnect. That is why `BluOsPlayPlan.StopFirst` exists, and why it is a
CONDITION rather than an unconditional stop — the host re-calls `PlayAsync` after a poll failure
too, and a player streaming perfectly well while a status request timed out must not be interrupted
to prove it.

**`/Volume?level=` answers with the new level**, so the setter needs no read-back.

**The status lags the command.** `/Stop` answered `stop` and the `/Status` immediately after it still
said `stream`. A watcher that read the next status as the truth would report a stop as having
failed; the player reports `Stopped` from the command itself.

**The same player writes its own address in two cases.** `/SyncStatus` gives `90:56:82:0A:BC:0D` and
the LSDP announcement gives `90:56:82:0a:bc:0d`. Nothing compares them today, and anything that ever
does has to fold the case first. The device's id comes from LSDP, which is also where the port comes
from — every player is on 11000 except a CI580, whose four zones are on 11000, 11010, 11020 and
11030.

**UDP 11430 bound with `ReuseAddress` on the first try**, so the fallback to an ephemeral port and a
unicast-reply query is written and UNMEASURED. What would exercise it is running the BluOS
controller app on the same Mac.

**Connecting the amp is a listener arriving**, which on an audience-gated station is what puts it on
air, and it is what the amp does daily anyway. The spike always stops what it started: a player left
streaming is a listener the station keeps counting with nothing left to stop it, which is the failure
the plugin's own dispose exists to avoid.

## Somewhere other than this Mac

**Changing output is a TRANSFER and never an addition.** A network player fetching the mount is a
listener to the station in its own right, anonymous and counted, so a moment with both playing is a
moment the station serves two audiences for one person — and on an audience-gated station it then
holds the mount open for five minutes for somebody who has walked away. `OutputSwitch` detaches,
stops and drops the old target before the new one is asked for anything.

**Detaching a handler is not enough by itself.** A player reports on whatever thread it likes, so an
event can already be on its way when the handover happens, and it would arrive telling the conductor
that the player it is now watching had stopped: a reconnect, of the wrong device, in the middle of a
deliberate move. Each subscription knows which target it belongs to and goes quiet once that is no
longer the current one.

**A handover is warm-up, not a stall.** The conductor is handed a player that has heard nothing, so
`TargetChanged` resets it; drawing the gap as a reconnection would describe a fault where somebody
asked for a move.

**`DesktopSettings.Volume` is THIS MACHINE's volume and nothing else.** A speaker's belongs to the
speaker: it is shared with whoever else plays to it and a hand on its front panel moves it, so
remembering it here would bring this Mac back at whatever the kitchen was set to. The slider writes
through to whatever is current and writes to the file only while the output is local, and it is drawn
DISABLED until a device has said how loud it is — one sitting at zero reads as silence rather than as
a question nobody has answered.

**Nothing ever moves playback on its own.** A device that stops answering is reported by its own
player, which the conductor already knows what to do with. Quietly falling back to this machine would
start the Mac's speakers unasked, in a room somebody may have left, and add a second listener while
the first was still being counted. A device missing from a scan is drawn as missing and left playing.

**A remembered device that is not there is reported and KEPT.** A speaker switched off tonight is on
again tomorrow, and forgetting would make the app's memory depend on whether anybody happened to open
it during the evening. It is matched by id first and address second, because a player given a new
lease is the same speaker.

**A device is never handed a station at `localhost`.** A speaker resolves an address for itself, so
that one means nothing to it, and what the operator gets is a device playing silence — the hardest
fault there is to read. `OutputReach` asks first and turns it into a sentence.

**Discovery runs at launch, on opening the picker, and on asking it to look again. Never on a timer.**
A scan is a broadcast plus a request to every device the operator wrote down, and between opens nobody
is looking at the answer.

**Switching a plugin off, or saving its settings, releases its device first**, so the speaker is
stopped by the plugin that owns it while that plugin is still there to stop it. The remembered choice
survives: the app took the plugin away for a moment, the operator did not change their mind.

**The bar shows the speaker as an ICON and not a name.** The first version drew the name, capped at
96px, and the 820px frame settled it: the bar is already full at its minimum width and the caption
pushed the expand button off the end. The icon takes the accent when the station is playing
elsewhere, which is the one fact somebody sitting at this machine cannot get by listening; which
speaker is a tooltip away and a click away.

**The system's now-playing widget is unchanged, and `Pause == Stop` now reads "or tell the device to
drop it".** Two things here are unmeasured: whether macOS keeps a Now Playing entry for an app that
is producing no audio itself, and whether Avalonia's headless renderer can capture a flyout at all
(the picker is rendered as a control on its own on the assumption that it cannot).

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
station address, and refusing to start is worse. But the appearance enum had no string converter, so a
hand-written file naming one failed to parse, the tolerance swallowed it, and the app started as
though it had never been configured, taking the station address with it. Found by RUNNING the app
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

## How it looks

**`Themes/Styles.axaml` is where a control's look lives, and `Themes/Tokens.axaml` is where a value
does.** Before them every size and weight was a literal in whichever view needed it, and the only
style in the tree was six lines inside `VoiceView` — which is why Library had the same "nothing says
which tab you are on" bug Voice had already fixed for itself. A class is the fix for a KIND of
control; a token is a value two of them share.

A style names a token rather than a hex, a font or a number a token already holds. The exceptions are
sizes that belong to one control and mean nothing elsewhere: a 40px transport circle, a 3px active
bar.

**A Thickness is not a double, and Avalonia will not widen one into the other.** `Border.card` set
its padding from a spacing token and threw on the first card that did not override the padding
itself — which was every card except the one that already existed. Padding tokens are `Thickness`.

**Type is IBM Plex Sans and IBM Plex Mono, and nothing else.** Mono is for figures — a timecode, a
bitrate, an eyebrow — because a column of proportional digits jitters as they change. The faces are
in `Assets/Fonts` with the naming facts that decide whether a weight is reachable written down beside
them: Skia reads TTF and OTF, so the woff2 the web console self-hosts could never have been used
here, and a family name after the `#` is the one INSIDE the file rather than the file's own.

**Assets are invisible to `avares://` without `<AvaloniaResource Include="Assets/**" />`.** Avalonia's
targets add the XAML and the application icon and nothing else, and a missing entry does not fail the
build: the font silently falls back to the system face.

**The app's icon is BUILT from `apps/web/public/logo-mark.png`, by `tools/macos/make-app-icon.py`.**
Same arrangement as `apps/android/tools/make-launcher-icon.py`: Pillow, run by hand on the rare day
the mark changes, and what it writes is committed — so `make-app-bundle.sh` needs no Python and CI
packages the app without one. It writes two things. `tools/macos/deadair.icns` is the bundle's icon,
copied into `Contents/Resources` and named by `CFBundleIconFile` WITHOUT its extension, which is that
key's own convention and shows the blank document icon rather than an error when it is wrong. And
`Assets/logo-mark.png` is the mark inside the app, which `Window.Icon` reads.

**The icns is a full-bleed SQUARE, and the circular badge is not what a Mac draws.** macOS 26 makes
every app icon one rounded square and supplies the mask itself; artwork that does not fill its canvas
is set on the system's own light grey plate. So the icon is the skull lifted off the mark onto a
field of the mark's green, edge to edge, at 72% of the canvas — wider than Apple's own proportions
because this is one heavy silhouette rather than a detailed drawing, and at 32px in a dock the extra
10% is the difference between a skull and a smudge. `Assets/logo-mark.png` keeps the disc, which is
the shape the mark was drawn as.

**The sidebar's title strip is the WORDMARK alone, and the mark was tried there and taken out.** The
console's header carries both and this app is the same app, so the pairing looked obviously right;
on a 38px strip beside the traffic lights it reads as clutter rather than as identity, because the
strip is already crowded by the 80px the window's buttons need. The icon says which app this is
before the window is even open.

**Two earlier versions of this icon were wrong in the same way, and neither was visible in the
file.** The first drew `logo.png` above 128px and the mark below, which is two icons wearing one
name and spends the sizes an icon is actually seen at on the one nobody looks at. The second inset
the disc to 858 of 1024, which was correct for the pre-26 grid and is now a smaller picture inside a
grey plate. **Both looked right in the .icns and wrong on screen**, so check an icon the only way
that answers the question: build the bundle and ask macOS what it draws for it.

```bash
swift -e 'import AppKit
let i = NSWorkspace.shared.icon(forFile: CommandLine.arguments[1])
let s = NSSize(width: 512, height: 512); let m = NSImage(size: s)
m.lockFocus(); i.draw(in: NSRect(origin: .zero, size: s)); m.unlockFocus()
try! NSBitmapImageRep(data: m.tiffRepresentation!)!.representation(using: .png, properties: [:])!
    .write(to: URL(fileURLWithPath: CommandLine.arguments[2]))' \
    apps/desktop/artifacts/deadair.app /tmp/icon.png
```

That renders what Finder and the Dock render, plate and mask and shadow included. `qlmanage -t` is
the obvious alternative and hangs in a sandboxed session.

**A rebuilt bundle at a path LaunchServices has already seen comes back as the blank DOCUMENT icon**,
which looks exactly like a missing `CFBundleIconFile` and is a stale registration. Re-register it and
the icon is there:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -f apps/desktop/artifacts/deadair.app
```

The grid numbers are gone from the script and are worth keeping here anyway, for anything that has to
draw its own shape on a Mac: on a 1024 canvas the grid's square is 824 across and its circle 858,
larger, because a circle of the square's width reads smaller than it is.

`Window.Icon` does nothing on macOS — the bundle is where a Mac looks — and is set because it is one
line and the alternative on the platforms after this one is the toolkit's placeholder.

**The macOS menu bar said "Avalonia Application", and the fix is two separate levers.**
`Name="deadair"` on the `Application` in `App.axaml` is the app name for every platform-specific
purpose, and it is what renames the menu itself and the Hide item; nothing else reaches them, and
`CFBundleName` in the Info.plist does NOT — it was already correct while the menu still said
Avalonia. That leaves "About Avalonia", which Avalonia puts in the app menu when nothing else claims
it, and the second lever is a `NativeMenu.Menu` on the Application: an item there REPLACES the
built-in About rather than sitting beside it. The system's Services, Hide, Show All and Quit are
appended below whatever is there and are not ours to write.

The one item in it is Settings, on ⌘, because that is the only place macOS users look for it. A
`NativeMenu` has no visual parent to inherit a DataContext from, so `App.OnFrameworkInitializationCompleted`
sets the Application's to the shell for that binding and nothing else — every window still sets its
own. An unbound `Command` leaves a native item DISABLED rather than failing, so a menu item that is
greyed out is a binding that did not resolve.

**There is still no Edit or Window menu, and that is a known gap rather than an oversight.** ⌘C/⌘V
work anyway, because Avalonia's own `PlatformHotkeyConfiguration` handles them inside its text
controls rather than through AppKit's menu key equivalents — which also means an Edit menu carrying
those gestures would TAKE them first, so adding one is a change that can break working paste and
needs testing rather than a quick win. Avalonia 12 has no menu-role API, so every item would be
hand-wired to `TextBox.Cut/Copy/Paste/SelectAll` against the focused element.

**Check the menu bar by asking macOS, not by reading the XAML.** The app has to be RUNNING and the
answers come out of the accessibility API, which needs Accessibility permission for the terminal:

```bash
osascript -e 'tell application "System Events" to tell process "deadair" \
    to get name of every menu item of menu 1 of menu bar item 2 of menu bar 1'
```

`menu bar item 1` is Apple's. Add `value of attribute "AXMenuItemCmdChar"` for an item's key
equivalent and `enabled of menu item` to prove a Command bound. This works against a plain
`dotnet run`, which is a far faster loop than rebuilding the bundle.

**Icons are `StreamGeometry` in `Themes/Icons.axaml`, keyed by name.** Fluent's Regular 20 set, pasted
as path data rather than pulled in as a package, because this app draws about twenty icons and a
package would be a dependency, a licence and a renderer for that. Every one inherits `Foreground`, so
nothing here names a colour. A key is a string, so a typo is a blank square rather than an error —
`NavigationTests` reads the dictionary and asserts every entry names one that is really there.

**Fluent's own accent is repointed through `FluentTheme.Palettes`.** Without it a stock control draws
Avalonia's blue beside this app's green. The volume thumb is the one that shows it, and it is NOT
reachable from a style: three selectors were tried against it with a garish test colour and none
matched, because Fluent gives the thumb a control theme carrying its own brush. Overriding
`SystemAccentColor` reaches some of Fluent and not that; the palettes reach all of it.

**A hover-revealed action moves `Opacity`, never `IsVisible`, in a column that is always there.**
Every row in this app is its own Grid, so a column that collapses when its content is hidden sizes to
that row alone and the page stops lining up. The same rule is why an `Auto` column cannot align down
a list.

## Navigation

**The rail replaces rather than pushes.** A rail is not history, so pressing Desk after Library does
not leave Library on a stack. Detail pages, when they arrive, will push onto one.

**A destination says whether it needs an account, and the rail hides what an account cannot reach.**
Desk and History need none, because listening is accountless and somebody who heard a record twenty
minutes ago should not have to sign in to learn its name. Signing out while on a gated page sends
them back to the desk rather than leaving them looking at an empty screen with no explanation.

**The player bar is on every page, and that is the shape of the app rather than a decoration.** It
used to be the bottom of the desk, so opening the Library took the transport, the playhead and the
lamp off the screen while the station kept playing. What is playing is not a page.

**The bar is a DockPanel and not three columns.** With a fixed left column and an `Auto` right one
the middle is whatever is left over, and at the window's 820px minimum that was nothing: the play
button drew over the timecode. Docked, the ends take what they need and the transport keeps the rest.

**`PageHost` builds each page once and sets its DataContext in code.** The seven pages used to be
stacked in a `Panel` with their visibility bound through the window, which laid all of them out on
every frame and made each one reach back up through `$parent[Window]` to find its own view model. The
pages are still built once and kept — they hold subscriptions and pollers, and rebuilding one per
visit would re-fetch a catalog somebody is walking back and forth through.

**Setting `DataContext` on a child re-scopes every binding on that element**, including `IsVisible`.
So a page whose visibility depends on the shell has to name the window's own DataContext explicitly:
`{Binding $parent[Window].((vm:ShellViewModel)DataContext).Navigation.IsDesk}`. Inheriting it looks
right, compiles, and fails at XAML load with a message naming the CHILD's type.

**A name that is both a property and a namespace resolves to the property.** `Navigation` and
`Notice` have both bitten this tree; the fix each time is a `using` alias rather than a rename, since
the property names are the ones the views read.

## Looking at a page without a screen

**`tools/Shots` renders a page to a PNG.** Avalonia's headless platform with real Skia drawing, a
window, three dispatcher passes and a captured frame. It exists because everything about this app
except how it LOOKS can be checked by running it, and a sandboxed session has no Screen Recording
permission — so a layout was the one thing going unverified.

```bash
dotnet run --project apps/desktop/tools/Shots -- artifacts/shots dark
dotnet run --project apps/desktop/tools/Shots -- artifacts/shots light
```

It asserts nothing and cannot fail meaningfully. A layout is judged by looking at it, which is the
thing an assertion cannot do; the value is entirely in the picture.

**It renders the SHELL, not pages.** Nearly every frame is the whole window — sidebar, page, bar —
because what goes wrong in this app goes wrong BETWEEN three controls rather than inside one, and a
page rendered on its own can show neither a bar overflowing its column nor a hero clipping beside the
operator card. Both of those were found this way and neither was visible in the code. There is a
frame at 820x520 for the same reason: the minimum window is where a layout runs out of room.

**An appearance is named rather than inherited.** `ThemeVariant.Default` follows the host, and
headless has no host, so a shot that did not say which appearance it wanted rendered light — and the
dark half of the app would go unlooked-at.

**Three dispatcher passes, not two.** The first measures and arranges and the second finishes it; the
third is for the desk, whose cover is sized in code from the room the page turned out to have. That
answer only exists after a pass has run, and setting it asks for another. On screen the same settling
happens across frames and is invisible.

**The window has to carry the theme's own background**, and for a shell frame the shell as well: the
desk's operator column names the WINDOW's DataContext deliberately, so a frame without one had every
binding through it fail — and a failed `IsVisible` binding defaults to TRUE, which drew Skip, Stop
and Start at once on a page with no operator.

**Do not attach the listener.** Attaching subscribes it to `/nowplaying`, and a poller against the
fake client's refusals marks the reading stale, so every desk frame carried "Not answering" including
the one meant to show a station that answers. The desk's frames are posed outright instead.

**The data matters as much as the layout.** Rows of one-word values look fine and prove nothing. The
fixtures use a long persona style, a wrapped talk break, a module name that runs past its column and
a title that has to trim, because that is where a layout actually goes wrong. They live in one place
and are reached through the shell, so a page cannot be looked at with different data from the shell
it is drawn in.

### What it found the first time it was pointed at a page

**In a list, an `Auto` column cannot line up down the page.** Every row is its own Grid, so `Auto`
sizes to that row alone — and a column whose content is sometimes hidden collapses to nothing on
those rows. The persona names started at two different x positions depending on whether that persona
was on air; the running order's durations marched about depending on whether a row's move buttons
were drawn; a production's metadata sat a foot from its title. **Fixed widths for any column that
must align, and a reserved width for any column holding something conditional.** `*` is safe, since
it resolves against the same available width on every row.

**Nothing said which tab you were on.** Four identical buttons, and the page beneath them was the
only clue. `Classes.active` bound to the same boolean the page switches on.

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
account: somebody who only listens should still be able to say whether they are looking at a light
app or a dark one. It is applied before the window is drawn, so it does not open in the wrong one and
repaint, and it is kept the moment it changes rather than on Save — Save is the STATION's button, and
an appearance you have to press it to see is one you cannot judge. The same is true of the format.

**There are no consoles here, and that is a decision rather than an omission.** This app carried the
web console's Carbon, Studio White and Neon, ported hex for hex, until it was noticed that they were
the wrong thing to port: a console is a page an operator opens and dresses to taste, and this app is
also a LISTENER. Somebody who has told macOS they want light has already answered the only appearance
question worth asking them. So the choice is System, Light or Dark, `ThemeVariant.Default` does the
following, and the three consoles remain the web console's own. Dark keeps Carbon's surfaces
unchanged; light is a neutral near-white carrying Studio White's status hues, which were the ones
measured against a light ground.

**Nothing migrates the old `theme` key.** The three had no light-or-dark answer between them, and an
absent key already means the system's choice, which is what somebody who never went looking for the
setting wants. A test says so.

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

**Words: pure state returns a `Message`, never a sentence — DESIGNED, not built.** There is no
`Message` type, no `Strings.resx` and no resolver in the tree yet; view models still carry their own
text. The intent, when the strings are pulled out: strings live in a resource file and are resolved
at the view edge, and a `Message.Text` carries only words the STATION sent — a silence remedy, an
attention row — which the client passes through verbatim and never rewrites.

**C# cannot check that a `switch` covers a closed hierarchy**, which is what makes that a real piece
of work rather than a rename: the resolver has to end in a throwing default with a reflection test
asserting every case has a resource key, buying at test time what Kotlin checks at compile time. It
is the one deviation from the Android precedent that is a language limitation rather than a
decision, and it is the reason this is written down before it is built.

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
dotnet run --project apps/desktop/spikes/PlayerSpike -- https://radio.example.com 20
```

And the app itself:

```bash
dotnet run --project apps/desktop/src/MaroonedSoftware.Deadair.Desktop
```

It keeps its settings in `~/Library/Application Support/deadair/settings.json`, which is a different
file from anything to do with a session: signing out must not take the station address with it,
because somebody who signs out is still a listener. The session itself is in the Keychain.

The version is `apps/desktop/package.json`, bumped by a changeset naming `@deadair/desktop` and
copied into `Directory.Build.props` by `pnpm release:version`; CI fails when the two disagree, so edit
the manifest and never the props. The changelog is `apps/desktop/CHANGELOG.md`, written from the same
changesets. To cut a release, run the `Desktop release` workflow; it takes no version, and reads the
one in `Directory.Build.props`. It runs the same gates as the
ordinary build, then the bundle script, and archives with `ditto` rather than `zip` — a plain zip
loses the resource forks and symlinks inside a bundle and produces something macOS unpacks into an
app that will not launch.

To build something that can be double-clicked:

```bash
apps/desktop/tools/macos/make-app-bundle.sh
```

About 112MB, self-contained, and unsigned — so the first launch needs a right-click and Open.

**Publishing for a runtime identifier used to rewrite every `packages.lock.json` to name that RID**,
after which a plain restore failed in locked mode because no project declared one — one packaging run
breaking the next build, found by running the CI sequence rather than by reading it. What fixed it is
the `RuntimeIdentifiers` line in `Directory.Build.props`: every lock file now names `osx-arm64` from
the start, a publish changes none of them, and the bundle script needs no flags of its own. Re-checked
2026-09-08 with the plugin projects added. If one ever does move, `dotnet restore --force-evaluate` is
what settles it.

Two publish flags are deliberately absent: `PublishTrimmed`, because the generated SDK reads JSON by
reflection and the trimmer cannot see it, and `IncludeNativeLibrariesForSelfExtract`, which is
incompatible with macOS and fails at RUN time with "Failed to create CoreCLR" rather than at
publish.

**In a sandboxed agent session, add `-m:1`.** MSBuild's parallel worker nodes connect over local
sockets, the sandbox refuses them, and the build hangs for exactly five minutes and then reports
`Build FAILED` with zero errors — which reads like a broken repository and is not one. NuGet restore
is refused the same way (`NU1301 ... Permission denied (localhost:PORT)`) even though the host is
reachable by curl, so a restore needs the sandbox off. Neither applies to CI.

**And a BUILD needs the sandbox off too, not just a restore.** Two more refusals, in the order they
surface. With a restore, NuGet's vulnerability audit cannot reach `api.nuget.org`, which is a warning
everywhere else and `NU1900 ... Warning As Error` here, because this tree treats warnings as errors.
Past that — `--no-restore` against an already-restored tree — `Avalonia.BuildServices.targets` throws
`MSB4018` wrapping `System.IO.IOException: Operation not permitted`, with the stack
`AvaloniaStatsTask.Execute` → `WriteTelemetry` → `Logger.LogException` → `Logger.AppendLine`. Read
that stack the right way round: the task is failing while writing the log entry that records its own
failure, so the error names the LOGGER rather than the write that was actually refused first, and
there is no property or environment variable in the targets to turn the task off. Both fail in about
four seconds with zero warnings and one error, which reads like a broken repository and is not one;
the same command with the sandbox off succeeds in three. Measured 2026-09-08 against Avalonia 11.3.2.
Neither applies to CI.
