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
plugins/*             bundled plugins: spotify, navidrome, musicbrainz, kokoro (the station's voice)
stream/, nginx/, docker-compose*.yml   Icecast, Liquidsoap and friends
```

Current `apps/api` modules: `data`, `crypto`, `authentication`, `permissions`, `policy`, `jobs`,
`catalog`, `onboarding`, `settings`, `stream`, `plugins`, `playlists`, `playout`, `enrichment`, plus
process-level `logging`. That list is the source of truth; check it before assuming a subsystem
exists.

## Where the real documentation is

- `packages/plugin-sdk/README.md` for the plugin contract, host capabilities, config fields, and
  versioning. Required reading before touching `plugins/` or `packages/plugin-sdk`.
- `docs/decisions/plugin-trust.md` for why plugins run in-process permanently, what that bought
  back, and which half of the JSON-safe rule survives. It supersedes the two below, both of which
  are still worth reading for their threat table and their deadline bounds respectively, and for
  nothing else.
- `docs/decisions/plugin-isolation.md` (superseded) for the four-row threat table that is still why
  the rate limiting, redirect chasing and breaker all exist.
- `docs/decisions/plugin-streaming.md` (superseded) for the bounds on a body read outside the call
  that fetched it, which survived the protocol they were written for.
- `docs/todo/` for work that was designed against the real tree and then deliberately deferred, and
  the seam each piece drops into. Read it before designing a station feature from scratch: the call
  may already have been made. It describes the current tree only.
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

**Sessions outlive the database.** Sessions and refresh-token families live in Redis, actors live in
Postgres, so a schema rebuild wipes one store and not the other and leaves browsers holding tokens
that verify against a user who no longer exists. The root `rebuild:data` and `db:reset` scripts
therefore end in `pnpm flush:sessions` (`redis-cli FLUSHALL`); a reset that skips it hands the
operator a session with no actor. The API rejects that state rather than trusting it, in
`authorization.context.middleware` for authenticated requests and in
`AuthenticationService.revokeIfSubjectIsGone` for the refresh grant, both of which revoke the
session and answer 401 instead of letting it through as a user who holds no permissions.

**The JSON-safe rule now covers what is stored or sent, and nothing else.** Manifests, permissions, config fields and every `capabilities/` payload: no `Date`, no class instances, no functions, durations as integer milliseconds, dates as ISO-8601 strings. The reason is Postgres and the console's JSON, not a wire format, and it survives on that basis alone. Host methods are exempt and deliberately so: `host.fetch` returns a real `Response`, `host.signal` a real `AbortSignal`, `speak()` a real `ReadableStream`. `boundary.json.safe.ts` fails `tsc` over a registered payload and its registry-coverage test fails over a boundary interface classified in none of its three arrays, so neither can drift by accident.

**Plugins are trusted code, permanently.** They load through a plain dynamic `import()` into the host realm and can reach `process.env`, `fs`, and the pg pool. `host.fetch` protects an honest plugin from a hostile upstream and protects the operator from a careless plugin. It does not contain a hostile one, and no future version will: the subprocess option is closed, not deferred. Do not write docs, UI copy, or comments claiming otherwise, and do not reintroduce a constraint whose only justification is a move that is not happening.

**`host.fetch` returns a real `Response`, and it is the only egress.** `response.body` is how bytes stream; there is no second path and the old `host.streams` protocol is gone. `timeoutMs` bounds getting the response (connect, headers, the whole redirect chain) and stops there, because a large body legitimately outlives the call that fetched it: reading it is bounded separately by `PLUGIN_BODY_IDLE_TIMEOUT_MS`, `PLUGIN_BODY_LIFETIME_MS` and `PLUGIN_RESPONSE_MAX_BYTES`, enforced by one guard wrapping every body. `url` and `redirected` are set by the host, because redirects are followed by hand to re-check the allowlist per hop and a constructed `Response` has neither. `jsonBody` / `tryJsonBody` are `async` free functions that keep the response the platform's own. A body nobody will read should be `cancel()`ed; `PluginHostFactory.cancelOpenBodies` is the backstop on dispose, not the plan.

**`host.fetch` policy is per upstream, and its budget is the live one.** `permissions.network` entries are bare hostnames, or objects carrying `ratePerSecond` and a shared `bucket` (a published limit usually covers a service, not a hostname), or `{ fromConfig: 'baseUrl' }` for an address the operator supplies. The fetch budget is capped by whatever the *current invocation* has left, published by `PluginInvoker` through `plugin.invocation.deadline.ts` and readable by plugins as `host.remainingMs()` (sync) or watched as `host.signal`, not by the `PLUGIN_INVOKE_TIMEOUT_MS` constant. `host.signal` is the invoker's own `AbortController` signal rather than a copy, so honouring it and being abandoned are the same moment. Everything the host throws at plugin code is a `PluginError`, never a `ServerkitError`: the invoker's `toPluginError` flattens anything else to `internal`, and the status the host chose never reaches the client.

**A plugin extends `Plugin` and registers its own teardown.** `packages/plugin-sdk/src/plugin.base.ts`: `this.host` is a getter that throws a sentence naming the plugin rather than a `TypeError`, and `register(disposer)` puts an undo beside its setup, run last-registered-first on unload even when one throws. This matters more in-process, not less, because a timer a plugin forgets lives in the API server until a restart and an operator reloads plugins on every config change. Extending it is optional; the host only ever asks for `PluginLifecycle`. Note `host` being a getter costs TypeScript's narrowing of other properties across a read of it.

**The station's voice is a plugin.** `speech` capability, `plugins/kokoro` first, Chatterbox expected. A voice is an opaque station-level id (`host`, `newsreader`) that the PLUGIN maps in its own config; the host never interprets it, and engine-specific knobs stay with the engine. `render.speechPluginId` picks the speaker when several can talk, and declines to guess when none is chosen. `RenderSegmentJob` walks a segment `planned → rendering → ready | failed`, and **a segment that is not `ready` is skipped, never waited for**, which is what keeps a broken renderer from ever costing the station silence.

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

**The mount is leased, not held.** `radio.liq` airs nothing unless the app is actively renewing a
short claim (`POST /control/onair`, `CONTROL_TTL_S`, default 6s), and `PlayoutPusher` renews it on
its reconcile only while `Rundown.hasProgramme()` **and** `AudienceWatch.gateOpen()`. So a crashed,
redeployed or freshly restarted API takes the station off air within seconds instead of leaving
Liquidsoap's local music bed playing to nobody's plan, and "Stop" means out of service rather than
fall back to the bed. Anything that grows a second way to drive playout has to renew the lease too,
or it will be silently muted. Do not write docs or comments claiming the mount is never silent: it
is silent exactly when deadair is not driving it, which is the point. See `stream/README.md`.

**The audience is the second half of that lease.** `playout.airMode` in `deadair.settings` is
`audience` (the default) or `always`; in `audience` mode the station airs only while somebody is
connected, so a loaded station with a full running order and no listeners is silent **on purpose**,
and the console says `ready` for it. The count is polled from Icecast's public `status-json.xsl`,
which is the truth, and pushed by Icecast's `listener_add`/`listener_remove` hooks into
`POST /playout/listener`, which only makes the arrival edge faster. That route's credential arrives
as HTTP basic and is moved onto `x-playout-secret` by `listener.credential.middleware`, which MUST
stay registered before `authenticationMiddleware`: ServerKit deletes `Authorization` from every
request, so a route can never read one for itself. `listener_add` is a blocking
auth call, so with the hooks on a dead API refuses new listeners: `stream.listenerHooks` turns them
off for an Icecast built without libcurl. Off air the transport hands over NOTHING and the falling edge
calls `/control/offair` at once, because Liquidsoap keeps consuming the playout queue whether or not
`driving()` selects it (measured: `remainingMs` falls with the wall clock while `driving` is false).
Anything left queued plays out to an empty mount at a download per track, which is the cost the gate
exists to avoid. A warm queue is therefore not available from the app side; it would take a clock
change in `radio.liq`. The console's own
`StreamMonitor` plays the mount, so an operator listening in the browser is an audience.

**Two database pools.** The runtime pool connects as the non-owner `app_user` role so RLS actually enforces; a separate owner pool handles privileged maintenance.

**Import aliases** are `#src/*`, `#routes/*`, `#modules/*`, declared as `paths` in
`apps/api/tsconfig.json` (there is no `imports` field in `apps/api/package.json`; docs that say
otherwise are stale). `#shared/*` is declared but points at a `src/shared` that does not exist:
shared code lives in `src/modules/shared`. Local imports carry `.js` extensions.

**Formatting and toolchain:** 4-space indent, single quotes, semicolons, print width 150, `arrowParens: avoid`. Node 26+, TypeScript 6, pnpm + Turborepo. `pnpm test` / `pnpm lint` / `pnpm build` run through turbo; per package, `pnpm --filter @deadair/api test`. Tests live in each package's top-level `tests/`, mirroring `src/`.

## Multi-package work

Larger features run as numbered handoffs under `.claude/handoffs/<nnn>-<slug>/`: a `_run.md` stating the goal, the package list with agent roles, and the dependency edges and why they exist, then one file per package with a matching `.result.md` written back when it lands. Completed run directories are the record and are not edited by later runs. Follow the existing shape when starting a new one.
