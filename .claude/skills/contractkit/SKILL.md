---
name: contractkit
description: Write or change ContractKit `.ck` contracts in `apps/api/data/contracts` and regenerate the routers, types and SDK they produce. Use whenever adding or changing an HTTP endpoint, a request/response shape, a query or path param, or an auth policy on a route, and whenever touching a generated `*.router.ts`, `src/modules/*/types/*.ts`, or `packages/sdk/src/**` file (the answer there is always "edit the `.ck` instead"). Also covers `.ck` syntax, `contractkit.config.json`, and why generated output did not change.
---

# ContractKit contracts

`.ck` files under `apps/api/data/contracts/` are the source of truth for every HTTP route in this
repo. One `.ck` edit regenerates code in three places. Never hand-edit any of them.

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

`{area}` comes from the file's own `options { keys: { area: ... } }` block, so that key decides
which module directory the types land in and which `sdk.<area>` namespace the client hangs off.
Split contracts by convention: `<area>.ck` holds `operation` declarations, `<area>.types.ck` holds
`contract` declarations.

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

Note a parser quirk when writing those comments: a `#` line is **not** legal directly in the
`options` block body, and a free comment before an `operation` becomes that *route's* description
and leaks into the SDK JSDoc. Put cascade notes inside the `security { }` block, or inside
`keys { }` when the floor is a bare `security: none` with no block to hold them.

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

- **The formatter still deletes comments inside a `security { }` block.** Above `policy:`, or above
  a `security: none` line — they are gone on the next `pnpm format`, silently. The identical bug in
  `response { }` blocks was fixed in 0.14, so comments there now round-trip; nobody has fixed this
  one. Put security rationale in the free-standing `#` block above the operation, or in the file
  header, both of which survive. `render.ck` does this deliberately. `plugins.ck` still carries a
  long note inside its `security { }` block that the next format run will eat.
- **The formatter drops the trailing newline** at end of file.
- **`rootDir` in `apps/api/contractkit.config.json` is an absolute `~/projects/deadair/` path.**
  It resolves case-insensitively on this Mac, but a checkout at another path silently compiles
  nothing (empty glob, no error). If a run reports zero files, look there first.
- **`operation(internal)`** still generates a router but no SDK client method. Use it for endpoints
  a browser or an upstream hits directly (OIDC callback, magic-link redirect, playout callbacks),
  not for anything the console calls.
- **Duplicate SDK method names within an area throw at codegen.** Disambiguate with an explicit
  `sdk:` on the verb, or move the operation into a `subarea`.
- **Method naming priority** is `sdk:` verbatim, else camelCased `name:`, else inferred from verb +
  path. Changing a `name:` renames the SDK method and breaks `apps/web` callers.
- **`readonly` / `writeonly` fields split a contract into three schemas** (`XBase`, `X`, `XInput`).
  The router validates request bodies and query against `XInput`, so a field marked `readonly`
  cannot be sent by a client, no matter what the service accepts.
- **Prettier runs on generated output** (`"prettier": true`), so a diff that is only formatting
  means the repo prettier config changed, not the contract.
- **`date` / `time` / `datetime` / `duration` / `interval` are Luxon objects over ISO-8601 strings**,
  not numbers. `duration` in particular renders as a Luxon `Duration` parsed from `"PT3M42S"`. It is
  the obvious-looking choice for a `durationMs` field and the wrong one: milliseconds stay
  `int(min=0)` here, because `apps/web` carries no luxon dependency and the plugin SDK's JSON-safe
  boundary specifies integer millis.
- **Comments become generated documentation.** A trailing `# ...` on a field becomes its `.describe()`
  and its SDK JSDoc; a comment above a field or an operation does the same. Rationale aimed at the
  next contract author does not belong there — it ends up in the public SDK type. Put it in this
  skill instead.

## Two refactors that look right and are not

Both were evaluated against the installed compiler and rejected. Do not re-propose them without new
information:

- **`params:` as a contract reference**, to dedupe a repeated `params: { id: ... }` block. The
  codegen spreads *inline* params as individual service arguments but passes a *referenced* params
  type as a single object, so hoisting rewrites every service method signature from `(id, ...)` to
  `(params, ...)`. `plugins.ck` keeps twelve duplicated blocks for this reason.
- **`format(input=snake)`** on the auth request contracts, to get camelCase TypeScript over a
  snake_case wire. It touches every `discriminated(by=...)` alias and `literal(...)` arm, and
  `codegen-contract.ts` carries a `TODO(multi-base)` noting that format inheritance follows only the
  first base — which those deeply-inherited contracts rely on.

Also note `signature:` generates `requireSignature(...)`, which is an HMAC over `ctx.rawBody`. It is
for webhooks. It does not fit the internal playout bridge routes, which present a static shared
secret and one of which is a GET with no body.
