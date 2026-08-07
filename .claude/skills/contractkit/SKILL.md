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

## Auth: three distinct spellings

The `security` block on an HTTP verb maps to `requirePolicy` in the generated router, and the three
forms are not interchangeable:

| In the `.ck` | Generated | Meaning |
| --- | --- | --- |
| `security: none` | no middleware | fully public (only the `/auth/*` bootstrap routes) |
| omitted entirely | `requirePolicy()` | do not rely on this; be explicit |
| `security: { policy: none }` | `requirePolicy({ policy: false })` | session required, no policy check |
| `security: { policy: platform.manage }` | `requirePolicy({ policy: 'platform.manage' })` | session + that policy |

`security: { policy: none }` is the default for station reads. Policy names must exist in
`apps/api/data/permissions/*.perm` (see `pnpm build:permissions`); a typo here is not caught by the
contract compiler.

## Syntax essentials

Full language reference: <https://github.com/MaroonedSoftware/contractkit#dsl-language-reference>.
Read it before reaching for a construct that no file in this repo already uses. The `.ck` files in
`apps/api/data/contracts/` are the working examples; `catalog/` is the most representative pair.

Cheat-sheet in [reference.md](reference.md).

## Gotchas

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
