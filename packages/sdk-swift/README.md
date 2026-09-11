# sdk-swift

The station's API as a Swift package, generated from the same `.ck` contracts as the TypeScript,
Kotlin and C# SDKs. It is what `apps/ios` talks to the station through. It has no `package.json`, so
pnpm and turbo never see it.

**Nothing in here is written by hand except `Package.swift` and this file.** Everything else is
emitted by `@contractkit/plugin-swift` from `apps/api/data/contracts/**/*.ck` and is overwritten by
`pnpm build:contracts` from the repository root. Editing a generated file is work that disappears
the next time anybody touches a contract, and CI notices: the `generated` job regenerates every SDK
and fails on anything that moved.

```
Sources/DeadairSdk/Runtime/SdkRuntime.swift   SdkConfig, SdkHttp, HTTPTransport, SdkError, SdkJSON
Sources/DeadairSdk/Runtime/JSONValue.swift    what `unknown` and `json` fields decode to
Sources/DeadairSdk/Runtime/Scalars.swift      bigint, decimal, date, time and duration as text
Sources/DeadairSdk/Models/<File>Models.swift  one file per contract file
Sources/DeadairSdk/Clients/<File>Client.swift one client per operations file
Sources/DeadairSdk/Deadair.swift              the aggregator
Package.swift                                 ours; created once and never regenerated
```

The module is `DeadairSdk` and the aggregator is `Deadair`; the generator refuses a type named after
the module that holds it.

## Using it

```swift
import DeadairSdk

let sdk = Deadair(config: SdkConfig(
    baseURL: URL(string: "https://radio.example.com/api")!,
    headers: { ["Authorization": "Bearer \(token.value)"] },
    transport: AgentTransport(URLSessionTransport(session: shared), userAgent: agent)
))

let now = try await sdk.nowplaying.getNowPlaying()
```

Two parts of `SdkConfig` decide how a client is wired, and `apps/ios` uses both deliberately:

- **`transport` is the one place a request leaves the SDK.** The app supplies `AgentTransport` from
  `DeadairCore`, which puts the app's one User-Agent on every request, over the same `URLSession`
  the artwork loader uses, because the station counts an HLS listener per IP and User-Agent and a
  second agent would be a second listener.
- **`headers` is called once per request**, so a token can rotate without rebuilding the client.
  `SessionManager` reads the bearer from a box it updates after a refresh, so the single replay of
  a call goes out with the new token through the same instance.

`baseURL` ends in `/api`: the edge strips that prefix and the API mounts its routers at the root.
The mounts and `/live.m3u8` are NOT under it.

## Three things that are easy to get wrong

**A status the contract declares as an outcome comes back as a value; anything else throws
`SdkError`**, which carries the status, the headers and the raw body. A 409 from
`POST /playout/start` means "nothing to resume" and is worth catching by status.

**A body that does not decode also throws `SdkError`, with the 2xx status it arrived under.** The
decoder's own error is folded into the message and not kept, so code that has to tell a missing
field from a body of the wrong kind entirely decodes `error.body` again itself. `StationProbe` in
`DeadairCore` does exactly that, because a missing field is an older station and the wrong kind of
body is not a station at all.

**`/auth/token` sends a form, not JSON.** The contract declares `application/x-www-form-urlencoded`
first and the generator uses the first declared type, so the grant's fields travel through the form
encoder. It is invisible at the call site and it is asserted by `TokenRequestEncodeTests` in
`DeadairCore`, because a wrong wire name there fails sign-in against a server behaving perfectly.

## When the generated code is wrong

**Fix it upstream, in the ContractKit repository, with a test and a changeset. Never here.** The
generator's README said its output had never met a compiler. The first build against these contracts
found one bug: a model field named `container` resolved, inside the generated `encode(to:)`, to the
encoder's local container of the same name. It was fixed upstream in `@contractkit/plugin-swift`
0.1.4, which is the floor this repository pins (0.1.3 cannot produce Swift that compiles against
these contracts), and ContractKit now builds its generated Swift with the toolchain in its own tests.

Compiling is one gate. **Decoding is a different one**: the fixtures under
`apps/ios/Packages/DeadairCore/Tests/DeadairCoreTests/Sdk` are the shapes the service really
produces. The bug they exist to catch is a wire name the compiler is perfectly happy with; the
Kotlin listener shipped one and sign-in failed at decode.

Building it, which CI does first and by name so a generator bug fails as itself. It builds for the
Mac with no simulator, which is also why the package names macOS beside iOS:

```bash
swift build --package-path packages/sdk-swift -Xswiftc -warnings-as-errors
```
