# deadair

An AI radio station. Today the repo is a Koa API (`apps/api`), a React console (`apps/web`), a
plugin system for music providers and enrichment sources (`packages/plugin-sdk`, `plugins/*`), and
the identity/permissions/settings chassis underneath them. The station actors themselves (director,
render pipeline, rundown, now-playing reactor) are the goal, not the current tree: audio never
touches Node, and Liquidsoap and Icecast run in sibling containers.

## Workspace

```
apps/api          Koa server, ContractKit routers, dbmate migrations
apps/web          React console (Vite, TanStack Router)
packages/plugin-sdk   the plugin contract and host capabilities
packages/sdk          typed client for the API
packages/error-codes  shared error code constants
packages/config-*     shared eslint / tsconfig
plugins/spotify   the bundled music provider
stream/, nginx/, docker-compose*.yml   Icecast, Liquidsoap and friends
```

Current `apps/api` modules: `data`, `crypto`, `authentication`, `permissions`, `policy`, `music`,
`onboarding`, `settings`, `plugins`, `playlists`, plus process-level `logging`. That list is the
source of truth; check it before assuming a subsystem exists.

## Where the real documentation is

- `packages/plugin-sdk/README.md` for the plugin contract, host capabilities, config fields, and
  versioning. Required reading before touching `plugins/` or `packages/plugin-sdk`.
- `docs/decisions/plugin-isolation.md` for why plugins are trusted in-process code and why the
  boundary is still JSON-safe.
- `docs/decisions/plugin-streaming.md` for how bytes would cross that boundary, and why the byte
  protocol is specified but not built.
- `apps/api/README.md` for the boot sequence, DI scoping convention and middleware. **Read its
  module and route tables as the target design, not the tree.** They describe station/playout/
  director/render/nowplaying/engine modules that are not built here yet, and a `config` module that
  does not exist. Verify against `src/modules/modules.ts` before relying on any entry.

## Gotchas

**Generated output.** ContractKit routers and types are generated from `.ck` files in
`apps/api/data/contracts` (`pnpm build:contracts`). Permission types in
`apps/api/src/modules/permissions/generated` come from `apps/api/data/permissions/*.perm` via pdsl
(`pnpm build:permissions`). Kysely types come from `pnpm build:datatypes` (enum override sync, then
kysely-codegen). `pnpm rebuild:data` rolls the schema all the way down and back up. Never hand-edit
any of it. Migrations are dbmate SQL under `apps/api/data/migrations`, schema `deadair`.

**The JSON-safe plugin boundary is strict, and structured-clone-safe is not the same thing.** No `Date`, no `Uint8Array`, no class instances, no functions, no live host objects in any payload crossing `PluginHost`. Durations are integer milliseconds, dates are ISO-8601 strings, bytes would be base64. The rule exists because the deferred isolation target is a subprocess over IPC, not `worker_threads`, and structured clone is a `worker_threads` affordance. `packages/plugin-sdk/tests/plugin.boundary.conformance.test.ts` enforces this with a `structuredClone` round-trip. If it fails, the payload is wrong, not the test.

**Plugins are trusted code.** They load through a plain dynamic `import()` into the host realm and can reach `process.env`, `fs`, and the pg pool. `host.fetch` protects an honest plugin from a hostile upstream and protects the operator from a careless plugin. It does not contain a hostile one. Do not write docs, UI copy, or comments claiming otherwise.

**`host.fetch` returns a POJO, not a `Response`.** `body` is always a whole string under a size cap, so there is no streaming and no binary. `setCookie` is a separate array, because `headers` is a `Record` and would silently keep only the last one. `url` is the final hop of the redirect chain, not necessarily what was requested. Parse with the free functions `jsonBody` / `tryJsonBody`; a method on the payload would make the payload unserializable.

**In plugin code, `undefined` means "not set". Never `null`.**

**Module lifecycle order is load-bearing.** The list in `apps/api/src/modules/modules.ts` is ordered deliberately and the comments there explain each placement. `PluginsModule` sits after everything its host reaches into, `PlaylistsModule` after `PluginsModule`, and `LoggingModule` stays last so every other module's shutdown logging is flushed before the log store closes. Work the first request does not depend on belongs in `ready()`, after the socket is up, not in `start()`.

**Logging is process-level and predates DI.** `RotatingLogStore` is constructed in
`setup.server.ts` before any container exists, published through `setLogStore`, and wrapped by
`FileTeeLogger` so every module's lines land on stdout and in `logs/`. `PluginLog` tees plugin
output to the app logger plus a per-plugin rotating file with its own verbosity gate. Malformed
`LOG_MAX_*` values fail loudly at boot by design.

**Config is dotenv-resolved at boot.** `setup.server.ts` builds a single `AppConfig` snapshot from
`AppConfigSourceDotenv` + `AppConfigResolverEnv`, then `scrubProcessEnv()` removes secrets from
`process.env`. Module setups read the snapshot, never `process.env`. The DB-backed settings layer,
the live `AppConfigStore` reload and `radio.env` materialization are planned, not built: today
`deadair.settings` has only a repository.

**Nothing watches `plugin_configs`.** A plugin's configuration changes only through
`PluginsService`, and every route there that writes one reinitializes the plugin itself. There is no
`LISTEN`/`NOTIFY` path and no trigger on the table (an earlier one was removed): a row edited out of
band is applied by `POST /plugins/:id/reload`, or not at all. Anything that grows a second writer of
that table has to call `PluginLifecycleManager.reinitPlugin` itself.

**Two database pools.** The runtime pool connects as the non-owner `app_user` role so RLS actually enforces; a separate owner pool handles privileged maintenance.

**Import aliases** are `#src/*`, `#routes/*`, `#modules/*`, declared as `paths` in
`apps/api/tsconfig.json` (there is no `imports` field in `apps/api/package.json`; docs that say
otherwise are stale). `#shared/*` is declared but points at a `src/shared` that does not exist:
shared code lives in `src/modules/shared`. Local imports carry `.js` extensions.

**Formatting and toolchain:** 4-space indent, single quotes, semicolons, print width 150, `arrowParens: avoid`. Node 26+, TypeScript 6, pnpm + Turborepo. `pnpm test` / `pnpm lint` / `pnpm build` run through turbo; per package, `pnpm --filter @deadair/api test`. Tests live in each package's top-level `tests/`, mirroring `src/`.

## Multi-package work

Larger features run as numbered handoffs under `.claude/handoffs/<nnn>-<slug>/`: a `_run.md` stating the goal, the package list with agent roles, and the dependency edges and why they exist, then one file per package with a matching `.result.md` written back when it lands. Completed run directories are the record and are not edited by later runs. Follow the existing shape when starting a new one.
