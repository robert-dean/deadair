# The listener

`apps/android` is the app somebody LISTENS to the station on, and `packages/sdk-kotlin` is the
generated client it talks through. The console is the operator's surface and is a different app
with different rules; nothing here is a broadcast desk.

Every paragraph records a measured failure and the fix that was chosen over the obvious one. Read
the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Where it sits

**Not a pnpm workspace member, deliberately.** There is no `package.json`, so the `apps/*` glob
skips it and turbo and the root `vitest.config.ts` never see it. That is the arrangement
`analysis/` already has and the reason is the same read from the other end: a Gradle build shares
no task graph, no `dist`, and no test runner with the TypeScript tree, so one CI job of its own is
cheaper and more honest than making it pretend. Its build droppings are in the ROOT `.gitignore`,
because that is the only one in the tree.

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

Both are fixed in `@contractkit/plugin-kotlin@0.1.1`, which is the floor this repo pins — 0.1.0
cannot produce Kotlin that compiles.

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

**Never probe the mounts to find out which exist.** A connection, however brief, is an audience for
the five-minute linger, so probing five formats puts a silent station on air and holds it there.
`GET /nowplaying` carries `mounts[]` for exactly this reason; read that.

**HLS listeners are counted per IP and User-Agent**, from playlist re-fetches inside a 15-second
window. So the User-Agent is set once and shared by the SDK's client, the image loader and
ExoPlayer, and two phones behind one NAT count as one listener — known, and accepted.

## Conventions

Kotlin official style, 4-space indent, files named PascalCase after the class they hold. The
repo's dot-notation file rule is for TypeScript and stays there. **Prettier does not see any of
this** — it has no parser for `.kt`, `.kts`, `.toml` or `.properties` — but it does check `.json`
and `.yml`, so keep configuration out of those two formats here.

Pure logic — URL resolution, mount selection, the playhead projection — stays free of `android.*`
imports so plain JVM unit tests cover it. There are no instrumented tests and none are wanted.

```bash
cd apps/android && ./gradlew :sdk:build :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```
