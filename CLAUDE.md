# deadair

An AI radio station: a Koa API that is also the station itself (director, render pipeline, rundown, now-playing reactor), a React console, and a plugin system for music providers and enrichment sources. Audio never touches Node; Liquidsoap and Icecast run in sibling containers.

## Where the real documentation is

Read these rather than re-deriving. They are current and detailed.

- `apps/api/README.md` for the module inventory, boot sequence, DI scoping convention, route table, and middleware. Start here for anything in `apps/api`.
- `packages/plugin-sdk/README.md` for the plugin contract, host capabilities, config fields, and versioning. Required reading before touching `plugins/` or `packages/plugin-sdk`.
- `docs/decisions/plugin-isolation.md` for why plugins are trusted in-process code and why the boundary is still JSON-safe.
- `docs/decisions/plugin-streaming.md` for how bytes would cross that boundary, and why the byte protocol is specified but not built.

## Gotchas

**Generated output.** ContractKit routers and types are generated from `.ck` files in `apps/api/data/contracts`; run `pnpm build:contracts` after editing one and never hand-edit the output. Kysely types come from `pnpm build:datatypes` (enum override sync, then kysely-codegen). `pnpm rebuild:data` rolls the schema all the way down and back up. Migrations are dbmate SQL under `apps/api/data/migrations`, schema `deadair`.

**The JSON-safe plugin boundary is strict, and structured-clone-safe is not the same thing.** No `Date`, no `Uint8Array`, no class instances, no functions, no live host objects in any payload crossing `PluginHost`. Durations are integer milliseconds, dates are ISO-8601 strings, bytes would be base64. The rule exists because the deferred isolation target is a subprocess over IPC, not `worker_threads`, and structured clone is a `worker_threads` affordance. `packages/plugin-sdk/tests/plugin.boundary.conformance.test.ts` enforces this with a `structuredClone` round-trip. If it fails, the payload is wrong, not the test.

**Plugins are trusted code.** They load through a plain dynamic `import()` into the host realm and can reach `process.env`, `fs`, and the pg pool. `host.fetch` protects an honest plugin from a hostile upstream and protects the operator from a careless plugin. It does not contain a hostile one. Do not write docs, UI copy, or comments claiming otherwise.

**`host.fetch` returns a POJO, not a `Response`.** `body` is always a whole string under a size cap, so there is no streaming and no binary. `setCookie` is a separate array, because `headers` is a `Record` and would silently keep only the last one. `url` is the final hop of the redirect chain, not necessarily what was requested. Parse with the free functions `jsonBody` / `tryJsonBody`; a method on the payload would make the payload unserializable.

**In plugin code, `undefined` means "not set". Never `null`.**

**Module lifecycle order is load-bearing.** The list in `apps/api/src/modules/modules.ts` is ordered deliberately and the comments there explain each placement. Work the first request does not depend on belongs in `ready()`, after the socket is up, not in `start()`.

**Config is layered and live.** dotenv underneath, the `deadair.settings` table layered on top, with a single `LISTEN deadair_settings_changed` so a console save reloads config with no restart. Modules that must react to a change subscribe to `AppConfigStore`. `radio.env` is materialized from those same settings for the Liquidsoap and Icecast containers, which cannot read Postgres.

**Two database pools.** The runtime pool connects as the non-owner `app_user` role so RLS actually enforces; a separate owner pool handles privileged maintenance.

**Import aliases** are `#src/*`, `#routes/*`, `#modules/*`, `#shared/*`, declared in `apps/api/package.json#imports`. Local imports carry `.js` extensions.

**Formatting and toolchain:** 4-space indent, single quotes, semicolons, print width 150, `arrowParens: avoid`. Node 26+, TypeScript 6, pnpm + Turborepo.

## Multi-package work

Larger features run as numbered handoffs under `.claude/handoffs/<nnn>-<slug>/`: a `_run.md` stating the goal, the package list with agent roles, and the dependency edges and why they exist, then one file per package with a matching `.result.md` written back when it lands. Completed run directories are the record and are not edited by later runs. Follow the existing shape when starting a new one.
