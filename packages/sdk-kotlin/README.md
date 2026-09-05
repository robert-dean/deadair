# @deadair/sdk-kotlin

The station's API as Kotlin: `@Serializable` models and a Ktor client, generated from the same
`.ck` contracts that produce the TypeScript SDK in `packages/sdk`.

**Everything under `src/` is generated. Never hand-edit it.** Run `pnpm build:contracts` from the
repo root; the plugin's configuration is the `@contractkit/plugin-kotlin` entry in
[`apps/api/contractkit.config.json`](../../apps/api/contractkit.config.json). The one file here
written by hand is `build.gradle.kts`.

## What it is for

The Android listener in [`apps/android`](../../apps/android) is the only consumer, and it compiles
this as its `:sdk` subproject — there is no publishing step and no artifact. It lives under
`packages/` rather than inside the app because it is an output of the contracts, like the
TypeScript SDK beside it, and a second consumer would take it from here too.

Like `analysis/` and `apps/android`, this is **not a pnpm workspace member**: there is no
`package.json`, so the `packages/*` glob skips it and turbo and vitest never see it.

## Using it

```kotlin
val sdk = DeadairSdk(
    SdkConfig(
        baseUrl = "https://radio.example.com/api",
        headers = { mapOf("User-Agent" to "deadair-android/0.1.0") },
        httpClient = myOkHttpBackedKtorClient,
    ),
)

val now = sdk.nowplaying.getNowPlaying()
```

Every method is a `suspend fun`. `SdkConfig.headers` is called once per request, so a token can be
refreshed without rebuilding the SDK. Supplying `httpClient` means the SDK never closes it, which
is what the app wants: one Ktor client over one OkHttp client, shared with image loading. The SDK
installs no Ktor `ContentNegotiation` plugin and reads and writes its own bodies.

A status the contract does not account for raises `SdkError`, which extends Ktor's
`ResponseException`. A non-2xx status the contract *does* give a meaning comes back as a value.

## When it does not compile

That is a bug in the generator, not in this directory, and the fix goes upstream to
`packages/plugin-kotlin` in the ContractKit repository — with a test and a changeset — never into
the output here, which the next `pnpm build:contracts` would overwrite.

This has already happened twice. The generator's README said its Kotlin had never been compiled
against a real toolchain, and the first attempt found both: a `/*` in contract prose opened a
nested comment that swallowed the rest of a file, and a default against a named `enum` contract
was emitted as its wire string rather than the enum member.

Both are fixed in `@contractkit/plugin-kotlin@0.1.1`, which is the floor this repo pins.

## Keeping it honest

CI regenerates all of this from the contracts and fails if anything moves, so an edited `.ck`
merged without its Kotlin beside it is a red check rather than a client that disagrees with the
API. The Android app's `NowPlayingDecodeTest` covers the other half — that the shapes decode what
the station actually sends — because a generator can be self-consistent and still be wrong about
the contract.
