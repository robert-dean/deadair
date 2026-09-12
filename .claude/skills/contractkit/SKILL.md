---
name: contractkit
description: Write or change ContractKit `.ck` contracts in `apps/api/data/contracts` and regenerate the routers, types and SDK they produce. Use whenever adding or changing an HTTP endpoint, a request/response shape, a query or path param, or an auth policy on a route, and whenever touching a generated `*.router.ts`, `src/modules/*/types/*.ts`, or `packages/sdk/src/**` file (the answer there is always "edit the `.ck` instead"). Also covers `.ck` syntax, `contractkit.config.json`, and why generated output did not change.
---

# ContractKit contracts

`.ck` files under `apps/api/data/contracts/` are the source of truth for every HTTP route in this
repo. One `.ck` edit regenerates code in every place the table below lists. Never hand-edit any of
them.

Everything below was checked against the installed toolchain: `@contractkit/cli` 0.11.5,
`@contractkit/core` 0.31.0, `@contractkit/plugin-typescript` 0.38.12, `@contractkit/prettier-plugin`
0.14.10, `@contractkit/plugin-docs` 0.4.1, and plugin-kotlin 0.1.6, plugin-csharp 0.1.5 and
plugin-swift 0.1.6. Behaviour here has changed under several of those releases, patch releases
included, so check the version before trusting a claim that contradicts what you observe. The
published packages ship `src/` and a `CHANGELOG.md`, so the answer is usually in
`node_modules/@contractkit/<plugin>/` rather than in a guess.

## The loop

1. Edit the `.ck` file (or add a new one under `apps/api/data/contracts/<area>/`).
2. Regenerate:
   ```bash
   pnpm build:contracts
   ```
3. Implement or update the service method the operation names.
4. Type-check both sides: `pnpm --filter @deadair/api build` and `pnpm --filter @deadair/sdk build`.

Add `--force` (`pnpm --filter @deadair/api exec contractkit --force`) when output looks stale: the
CLI caches by file hash under `.contractkit/cache`. The cache is also fingerprinted with the
contractkit package versions, so a dependency bump drops it on its own.

## What one file generates

Given `apps/api/data/contracts/<area>/<filename>.ck`, per `apps/api/contractkit.config.json`:

| Output | Path |
| --- | --- |
| Koa router | `apps/api/src/routes/<filename>.router.ts` |
| Server types (Zod) | `apps/api/src/modules/{area}/types/<filename>.ts` |
| SDK client | `packages/sdk/src/{area}/<filename>.client.ts` |
| SDK types | `packages/sdk/src/{area}/types/<filename>.ts` |
| SDK aggregator + barrel | `packages/sdk/src/deadair.sdk.ts`, `packages/sdk/src/index.ts` |
| Kotlin models + clients | `packages/sdk-kotlin/src/commonMain/kotlin/com/maroonedsoftware/deadair/sdk/{models,clients}/` |
| Kotlin runtime + aggregator | `.../sdk/runtime/{SdkRuntime,Serializers}.kt`, `.../sdk/DeadairSdk.kt` |
| C# models, clients, runtime | `packages/sdk-csharp/{Models,Clients,Runtime}/`, `packages/sdk-csharp/DeadairSdk.cs` (the `.csproj` is hand-owned) |
| Swift models, clients, runtime | `packages/sdk-swift/Sources/DeadairSdk/{Models,Clients,Runtime}/` (`Package.swift` is hand-owned) |
| Website API reference | `apps/site/docs/api-reference/{area}/*.md`, `.../models/{area}/*.md`, `_category_.json` per folder |
| OpenAPI 3.1 spec | `apps/site/static/openapi.yaml`, served at `deadair.radio/openapi.yaml` |

The website pages come from `@contractkit/plugin-docs`'s `docusaurus` target. `index.md` in that
folder is written once and then left alone, so it is the one hand-edited file there. The pages are
Markdown, which Prettier ignores here, but the `_category_.json` files and `openapi.yaml` are not, so
they come out of the generator already in Prettier's form; if a version bump changes that, add them
to the `prettier --write` roots in `build:contracts`. Both come from `@contractkit/plugin-docs`, which
before 0.3.1 wrote a spec no YAML parser accepted, named SDK methods the SDK does not have, and left
a file-level `security` floor off the pages: do not pin it below that.

`{area}` comes from the file's own `options { keys: { area: ... } }` block, so that key decides
which module directory the types land in and which `sdk.<area>` namespace the client hangs off.
Split contracts by convention: `<area>.ck` holds `operation` declarations, `<area>.types.ck` holds
`contract` declarations.

### The Kotlin output

A second plugin, `@contractkit/plugin-kotlin`, generates a Ktor client for the Android listener.
Its config is three keys — `baseDir`, `packageName`, `sdkName` — and both `scaffold` and
`includeInternal` are deliberately off: `apps/android` owns the Gradle file, and an
`operation(internal)` has no business on a listener's phone. One model file per contract file, one
client per operation file; there is no `area`/`subarea` nesting, so `authentication.factor.ck`
becomes `AuthenticationFactorClient` rather than a member of an `authentication` namespace.

**Nothing about the Kotlin output is checked by Prettier** — it has no parser for `.kt` — so
`build:contracts` re-formats only the three TypeScript roots and the Kotlin is committed exactly as
emitted. It is compiled by `apps/android`'s `:sdk` subproject and by nothing else.

**Kotlin that does not compile is a generator bug**, and it is fixed upstream in the ContractKit
repository with a test and a changeset, never in the output. The generator's own README says its
Kotlin had never been put through a toolchain, and the first attempt here found two: a `/*` in
contract prose opened a nested comment that swallowed the rest of a file (Kotlin block comments
NEST, so escaping `*/` alone is not enough), and a default against a named `enum` contract was
emitted as its wire string rather than the enum member. Both are fixed in 0.1.1, and the floor this
repo pins has moved well past it since. The C# and Swift SDKs follow the same rule: CI compiles
each in its own job (`dotnet build -warnaserror`, `swift build -Xswiftc -warnings-as-errors`), and output
that fails there goes upstream too.

## The two hand-maintained edges

Codegen does not wire itself up. After adding a **new** `.ck` operation file:

- Register the router in [routes.setup.ts](apps/api/src/routes/routes.setup.ts). It is a
  hand-written import list; a generated router that is not in it is dead code.
- Make sure every service named in `options { services: { ... } }` exists and is registered in its
  module's DI container. The generated router calls `ctx.container.get(SomeService)` and then the
  method named in `service:`, so the method signature has to match the operation's params, query
  and body, in that order.

## Auth: four distinct spellings

The `security` block maps to `requirePolicy` in the generated router, and the forms are not
interchangeable:

| In the `.ck` | Generated | Meaning |
| --- | --- | --- |
| `security: none` | no middleware | fully public |
| **omitted entirely** | `requirePolicy()` | **session AND the `auth.session.mfa.satisfied` policy.** Not public. See below |
| `security: { policy: none }` | `requirePolicy({ policy: false })` | session required, no named policy. Accepts *any* signed-in actor |
| `security: { policy: platform.view }` | `requirePolicy({ policy: 'platform.view' })` | session + that policy |

**Omitting the block is the trap.** It reads like "no security" and is the opposite: a bare
`requirePolicy()` gates on a session plus the MFA policy. That is exactly how
`/auth/login/link/redirect` ended up 401-ing every magic-link click, and nothing in the toolchain
warns about it. Always write the block, at some level of the cascade.

### The cascade

`security` is legal in three places, and `resolveSecurity` in `@contractkit/core` resolves
**operation → route → file**, nearest wins:

- inside the file-level `options { }` block, as the floor for every operation in the file
- on a route, as the floor for its verbs
- on a verb

Most files in this repo declare the floor once in `options` and override only where an operation
genuinely differs. **This means reading a single verb no longer tells you its security** — check the
options block too. Every floor carries a comment saying what it is and which operations override it.

Since core 0.26 there is a safe home for those comments: **inside the `security { }` block, or on
the line(s) directly above a `security:` key in a verb body.** Both round-trip through the formatter
and neither reaches generated documentation. That is the place to write the rationale.

The one position that still leaks is a comment run sitting *directly* above an `operation` with no
blank line between: it becomes that route's description and surfaces on any verb that has none of
its own. Leave a blank line and it is a standalone divider instead, kept verbatim and generated
nowhere.

### Choosing a policy

Only two application policies are registered: `platform.view` and `platform.manage`
(`apps/api/src/modules/policy/policy.mappings.ts`). The convention, set by `playout.ck` and now
followed by catalog, playlists and plugins:

- **reads** → `platform.view`, which both the `listener` and `admin` roles grant
- **writes / operator actions** → `platform.manage`, which only `admin` grants
- **`policy: none`** only where a role gate would be wrong. `/auth/factors/*` is the real case: you
  cannot require a role or MFA to enroll a first factor.

Prefer the *strict* end as a file floor where a file is mostly writes, as `plugins.ck` does. A route
added without a block then inherits the tighter gate and gets reported as over-gated, rather than
silently landing on the looser one.

Two live constraints:

- `platform.edit` exists in `core.perm` but is **not** in `ServerPolicyMappings`. Naming it in a
  `.ck` compiles clean and fails at runtime. Policy names are not checked by the contract compiler.
- The object-scoped `plugin.*` permissions (`configure`, `enable`, `oauth`) **cannot** be named in a
  contract. `requirePolicy` asserts with `{ session }` only, so a policy has no object id to scope
  on. Using them needs a policy class first.

## Syntax essentials

Full language reference: <https://github.com/MaroonedSoftware/contractkit#dsl-language-reference>.
Read it before reaching for a construct that no file in this repo already uses. The `.ck` files in
`apps/api/data/contracts/` are the working examples; `catalog/` is the most representative pair.

Cheat-sheet in [reference.md](reference.md).

## Responses: several statuses, several mimes

Since `plugin-typescript@0.31` / `prettier-plugin@0.14`, a status may declare **more than one mime**
and an operation **more than one status**. Do not carry over the old workaround of declaring one
lying mime and letting the client sniff.

- Several mimes on a status → the service returns a `contentType` alongside the body and the router
  sets `ctx.type` from it. `render.ck`'s `/segments/{id}/audio` and `art.ck`'s `/art/{id}` are the
  worked examples; both used to announce one type for four formats.
- Several statuses → the service returns a union discriminated on `status`, and the SDK returns a
  matching union rather than throwing.
- **Which statuses the service must produce is derived from the declaration: a status is emitted if
  it has a block, or is 2xx.** So `304:` (bare) means "documented, something else produces it" —
  which is what both binary routes want, because the conditional-GET middleware produces it. `304: {}`
  would mean the service returns it. `404(documented): { … }` forces a block-carrying status back
  onto the throw path.
- No contract here declares a body on an error status, so the 0.31 behaviour change (error bodies
  now returned rather than thrown) does not apply to this repo. Check before adding one.

## Gotchas

- **The formatter used to eat comments in and around a `security { }` block, and dropped the
  trailing newline. Both were fixed in core 0.26 / prettier-plugin 0.14.1.** Comments inside a
  `security { }` block, above a body key in an operation body, above a verb that already carries its
  own inline `# ...`, and after the last key before a closing brace all round-trip now, as do
  comments above `options`, inside the `options` body, and on a `keys`/`services` entry. `art.ck` and
  `render.ck` each still hoist a security note out to the file header to dodge the old bug; that is
  no longer necessary, and new contracts should put the rationale where it belongs.
- **A bare `#` in a `name:` is data, not a comment.** Only whitespace-then-`#` opens one, so
  `name: Generate C# client` now keeps its full text where it used to truncate silently to
  `Generate C`. The SDK method name derives from `name:`, so a contract that was relying on the
  truncated value gets its method renamed. Nothing in this repo has a `#` in a `name:`.
- **The CLI deletes generated files it no longer claims.** Remove or rename a `.ck`, or shrink a
  plugin's `output` set, and the orphaned `.ts` goes with it on the next run. Do not hand-delete
  generated output; run `pnpm build:contracts` and let the cleanup do it, then drop the router from
  `routes.setup.ts`, which is hand-written and will otherwise import a missing file.
- **`rootDir` in `apps/api/contractkit.config.json` is the RELATIVE `../..`.** It was an absolute
  `~/projects/deadair/` path once, which resolved on exactly one machine and matched there only
  because macOS ignores case; CI's `generated` job compiled nothing (empty glob, no error). If a run
  reports zero files, look there first.
- **`operation(internal)`** still generates a router but no SDK client method. Use it for endpoints
  a browser or an upstream hits directly (OIDC callback, magic-link redirect, playout callbacks),
  not for anything the console calls.
- **Duplicate SDK method names within an area throw at codegen.** Disambiguate with an explicit
  `sdk:` on the verb, or move the operation into a `subarea`.
- **Method naming priority** is `sdk:` verbatim, else camelCased `name:`, else inferred from verb +
  path. Changing a `name:` renames the SDK method and breaks `apps/web` callers.
- **`readonly` / `writeonly` fields split a contract into two schemas** (`X` and `XInput`; the
  unexported `XBase` that used to sit between them went in plugin-typescript 0.34). The router
  validates request bodies and query against `XInput`, so a field marked `readonly` cannot be sent
  by a client, no matter what the service accepts.
- **Prettier runs on generated output** (`"prettier": true`), but what it produces is NOT what
  `prettier --check` accepts, so `build:contracts` re-formats the output itself afterwards. Measured
  on `getArt`, `getVoiceSample`, `getSegmentAudio` and `getPadAudio`: a single-parameter method whose
  return type is a union long enough to break comes out with the parameter on its own line, and
  plain prettier puts it straight back inline — with the `@contractkit/prettier-plugin` loaded and
  without it, so the plugin is not the cause. That left the two CI jobs demanding opposite bytes.
  The `generated` job regenerates and fails on any change; `build` runs `prettier --check .`; no
  committed state satisfied both, and fixing either one broke the other on the next push. So the
  script is `contractkit && prettier --write` over the three output roots, which makes prettier's
  form the fixed point whatever the generator's printer does next version. A cold run still reports
  those files as written — contractkit rewrites them, prettier corrects them, and the tree lands in
  the same place either way.
- **A local `build:contracts` compiles only what the cache has invalidated**, so it reports
  `N unchanged` for files it never looked at. CI checks out fresh with no `.contractkit/cache` and
  compiles every file, which is why it can fail on output a local run just called clean. To
  reproduce, `rm -rf .contractkit/cache` first. A plugin release that changes its output also bumps a
  `*_CODEGEN_VERSION` the cache is fingerprinted with, so a kit bump invalidates on its own; clear
  it anyway before committing one, and run it twice to see the output is stable.
- **`date` / `time` / `datetime` / `duration` / `interval` are Luxon objects over ISO-8601 strings**,
  not numbers, on BOTH sides since plugin-typescript 0.34: the router parses them and the SDK
  revives them, so `apps/web` receives a `DateTime` and not the ISO text. The shared moment helpers
  in `apps/web/src/components/shared/feed.moment.ts` accept either, because plugin capability
  payloads still carry strings under the JSON-safe rule. `duration` renders as a Luxon `Duration`
  parsed from `"PT3M42S"`; it is the obvious-looking choice for a `durationMs` field and the wrong
  one, because the plugin SDK's JSON-safe boundary specifies integer millis, so milliseconds stay
  `int(min=0)` here.
- **The SDK sends a `date`, `time` or `decimal` in the text the router parses** (0.38.8 for path,
  query and header params, 0.38.9 for request bodies). Before that a `DateTime` for a `date` went out
  through `toISO()` as a full timestamp, and the router, which reads `date` with `fromFormat`,
  answered 400. So a caller passes the `DateTime` itself. In a request body a string passes through
  untouched, so a caller that already formats one keeps working.
- **The SDK's default `X-Request-ID` works on a page that is not a secure context** since 0.38.12.
  Before it, the default was `crypto.randomUUID()`, which a browser defines only on HTTPS or
  localhost, so a station opened at `http://<its LAN address>:8080` threw on every request before
  `fetch` ran and the console read that as "Can't reach the station" (issue #78). The console passes
  no `requestIdFactory` of its own and relies on this, and `apps/web/tests/api/client.insecure.test.ts`
  holds the default to it: **do not pin plugin-typescript below 0.38.12.**
- **A header declared with a capital in its name is read from its lowercase key** (0.38.8). Node
  lowercases every incoming header, so before that a required `xTenant` was always missing. This
  repo declares no request headers at all: every `headers:` block here is on a response.
- **A `bigint` travels as a digit string, `"123"` or `"123n"`**, never a JSON number, and the Zod
  schema turns only a string of that shape into a `bigint` (0.38.7). The OpenAPI output says
  `type: string, format: bigint` since plugin-docs 0.4.0.
- **A path param named after a reserved word or a name the method already binds is renamed with a
  trailing underscore** (`class_`, `body_`) in the SDK signature and the router's locals (0.38.6).
  Arguments are positional on both sides, so neither callers nor service methods change.
- **An operation with no `response:` block, or only bare error statuses, answers 204** (0.34). It used
  to answer 200, or the first bare error status, on success. Declare `200:` if you mean it.
- **`int` and `number` no longer coerce `null`, `[]` or `true`** (0.34). Those now 400 where they
  validated as `0`, `0` and `1`. String-shaped numbers still coerce, so query and headers are unaffected.
- **Inline `query:` and `headers:` fields are required unless marked `?` or given a default** (0.34),
  in the SDK signature and the OpenAPI document as well as the router, which always required them.
- **Comments become generated documentation.** A trailing `# ...` on a field becomes its `.describe()`
  and its SDK JSDoc; a comment above a field or an operation does the same. Rationale aimed at the
  next contract author does not belong there — it ends up in the public SDK type. Put it in this
  skill instead.

## Two refactors that look right and are not

Both were evaluated against the compiler of the day and rejected. The first still holds on 0.38.12;
the second has lost its generator argument, and what is left is its size:

- **`params:` as a contract reference**, to dedupe a repeated `params: { id: ... }` block. The
  codegen spreads *inline* params as individual service arguments but passes a *referenced* params
  type as a single object, so hoisting rewrites every service method signature from `(id, ...)` to
  `(params, ...)`. `plugins.ck` keeps twelve duplicated blocks for this reason.
- **`format(input=snake)`** on the auth request contracts, to get camelCase TypeScript over a
  snake_case wire. It was rejected on two grounds. The generator one is gone: `codegen-contract.ts`
  carried a `TODO(multi-base)` saying format inheritance followed only the first base, which those
  deeply-inherited contracts rely on, and 0.38.5 flattens a `format()` contract with every base's
  fields, other files' included, and the TODO is no longer in the source. The other still stands:
  it touches every `discriminated(by=...)` alias and `literal(...)` arm, and changes what the
  Kotlin, C# and Swift SDKs send. Re-propose it only with the full regenerated diff in hand.

Also note `signature:` generates `requireSignature(...)`, which is an HMAC over `ctx.rawBody`. It is
for webhooks. It does not fit the internal playout bridge routes, which present a static shared
secret and one of which is a GET with no body.
