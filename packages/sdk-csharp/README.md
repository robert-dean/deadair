# @deadair/sdk-csharp

The station's API as a C# client, generated from the same `.ck` contracts as the TypeScript and
Kotlin SDKs. It is what `apps/desktop` talks to the station through.

**Nothing in here is written by hand except `DeadairSdk.csproj`.** Everything else is emitted by
`@contractkit/plugin-csharp` from `apps/api/data/contracts/**/*.ck` and is overwritten by
`pnpm build:contracts` from the repository root. Editing a generated file is work that disappears
the next time anybody touches a contract, and CI notices: the `generated` job regenerates all three
SDKs and fails on anything that moved.

```
Runtime/SdkRuntime.cs     SdkHttp, SdkOptions, SdkException, SdkResponse, SdkPart
Runtime/Converters.cs     SdkJson.Options and the scalar converters
Models/<File>.cs          one file per contract file
Clients/<File>Client.cs   one client per operations file
DeadairSdk.cs             the aggregator
DeadairSdk.csproj         yours; created once and never regenerated
```

## Using it

```csharp
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Runtime;

using var sdk = new DeadairSdk(new SdkOptions
{
    BaseUrl = "https://radio.example.com/api",
    HttpClient = shared,
});

var now = await sdk.Nowplaying.GetNowPlayingAsync(cancellationToken);
```

Two properties of `SdkOptions` decide how a client is wired, and `apps/desktop` uses both
deliberately:

- **`HttpClient` is supplied and never disposed by the SDK.** The desktop passes the one client every
  request in the app goes through, because the station counts an HLS listener per IP and User-Agent
  and a second client would be a second listener.
- **`Headers` is called once per request**, so a token can rotate without rebuilding the SDK. The
  desktop leaves it unset and attaches the bearer in a `DelegatingHandler` instead, so that the
  refresh and the single replay live in one place rather than beside every call.

`BaseUrl` ends in `/api`: the edge strips that prefix and the API mounts its routers at the root.
The mounts and `/live.m3u8` are NOT under it.

## Three things that are easy to get wrong

**A status the contract declares as an outcome comes back as a value; anything else throws
`SdkException`**, which carries the status, the raw body and the body parsed as JSON. A 409 from
`POST /playout/start` means "nothing to resume" and is worth catching by status rather than by
message.

**Serialize a model by hand with `SdkJson.Options`.** `decimal`, `bigint` and `duration` need the
converters registered there, and a plain `JsonSerializer.Serialize` writes shapes the API rejects.

**`/auth/token` sends a form, not JSON.** The contract declares `application/x-www-form-urlencoded`
first and the generator uses the first declared mime, so the grant's fields travel through
`SdkHttp.Params`. It is invisible at the call site and it is asserted by
`TokenRequestEncodeTests` in `apps/desktop/tests`, because a wrong wire name there fails sign-in
against a server that is behaving perfectly.

## When the generated code is wrong

**Fix it upstream, in the ContractKit repository, with a test and a changeset. Never here.** The
Kotlin SDK's first three released fixes were all compile errors a real toolchain would have caught,
which is why `@contractkit/plugin-csharp` has an output test that runs `dotnet build` with warnings
as errors, and why this SDK compiled on first contact where that one did not.

Compiling is one gate. **Decoding is a different one**, and it has no upstream test: the fixtures in
`apps/desktop/tests/MaroonedSoftware.Deadair.Sdk.Tests` are the shapes the service really produces,
one per branch. The bug they exist to catch is a wire name the compiler is perfectly happy with —
the Kotlin listener shipped one and sign-in failed at decode.

Building it, which `apps/desktop` and CI both do by name so a generator bug fails as itself:

```bash
dotnet build packages/sdk-csharp/DeadairSdk.csproj -warnaserror
```
