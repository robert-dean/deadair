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

**Stopping really does drop the connection, and neither obvious witness shows it.** Icecast's
listener count cannot: an audience lingers five minutes past the last listener, on purpose, so a
reconnecting player does not cut the broadcast. And an `lsof` on our own process shows one connection
that never moves, which is the API client's keep-alive rather than the audio — **macOS streams media
from a helper daemon, so the audio socket is not in this process at all.** Counting connections to
the station from every process except this one is what answers it: one while playing, zero after
`StopAsync`, with the process still alive. That is the measurement behind the rule, rather than a
reading of Apple's documentation.

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
supported.

**The refresh is single-flight, and that is not tidiness.** Refresh tokens are single-use and
rotating, and presenting a spent one revokes the whole family — so two pollers hitting 401 together
must produce one refresh, and the lock has to re-check whether the token it set out to replace is
still current after it acquires. **A session ends on a 4xx to the refresh and on nothing else**: not
a network failure, not a 5xx.

**Roles come from `GET /auth/session` and are a HINT.** They decide what is drawn; the API decides
what is allowed. A 403 refreshes them rather than being reported as a failure. The web console gates
nothing at all and lets every 403 through to the user, which is a defensible choice for a page that
is only ever opened by the operator and the wrong one for an app that is also a listener.

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
because somebody who signs out is still a listener.

**In a sandboxed agent session, add `-m:1`.** MSBuild's parallel worker nodes connect over local
sockets, the sandbox refuses them, and the build hangs for exactly five minutes and then reports
`Build FAILED` with zero errors — which reads like a broken repository and is not one. NuGet restore
is refused the same way (`NU1301 ... Permission denied (localhost:PORT)`) even though the host is
reachable by curl, so a restore needs the sandbox off. Neither applies to CI.
