# @deadair/api

The deadair API: a Koa server (via `@maroonedsoftware/koa` "ServerKit") that will eventually be the
radio station itself. Today it serves the console's JSON API and hosts the plugin system that music
providers and enrichment sources plug into. The station actors (director, render pipeline, rundown,
now-playing reactor) are not in this tree yet; audio never touches Node, and Liquidsoap and Icecast
run as sibling containers from the repo-root compose files.

Everything is assembled from **modules**. A module is a `ServerKitModule`: an object with optional
`setup` / `start` / `ready` / `shutdown` hooks that registers its classes into the injectkit DI
registry and, where it owns long-lived work, starts and stops it. The full, ordered list lives in
[modules.ts](src/modules/modules.ts) and the order is meaningful (comments there explain each
placement). `setup` / `start` / `ready` walk the list forwards and `shutdown` walks it **backwards**,
so a module tears down before the modules it depends on — and anything that must close LAST is
registered FIRST.

---

## Layout

```
src/
  index.ts          entrypoint: reflect-metadata, then setupServer()
  server/           builder wiring, middleware, env scrubbing
  routes/           ContractKit-generated routers, bound in routes.setup.ts
  modules/          the app, one directory per module (below)
  modules/shared/   cross-module types (pagination)
  logging/          process-level rotating log store and the tee logger
data/
  contracts/        .ck contract definitions; `pnpm build:contracts` generates routers/types
  permissions/      core.perm authorization model; `pnpm build:permissions` generates src/modules/permissions/generated
  migrations/       dbmate SQL migrations (schema `deadair`)
scripts/            rollbackall.sh, enum-override sync, and the *.smoke.ts tools (type-checked, never built)
tests/              vitest suites, mirroring src/
```

Import aliases are `#src/*`, `#routes/*` and `#modules/*`, and they are declared in three places
because three different things resolve them. [tsconfig.json](tsconfig.json)'s `paths` is what
type-checks them, and `tsc` never rewrites the emitted specifier, so a compiled `dist/` still asks
for `#src/...`. `package.json#imports` is what answers that at runtime: it maps each alias to
`dist/` by DEFAULT, which is what makes `node dist/index.js` work in a production image, and to
`src/` under the `development` condition, which is why [dev.watch.mjs](scripts/dev.watch.mjs) passes
`--conditions=development` — without it the dev server would prefer a stale `dist/` over the file
just saved. [vitest.config.ts](vitest.config.ts) spells the same mapping out a third time because
its esbuild transform reads neither of the other two. Shared types live under `src/modules/shared`
and are imported by relative path. Local imports carry `.js` extensions.

### Boot sequence

`setupServer()` ([src/server/setup.server.ts](src/server/setup.server.ts)):

1. Builds the **boot** snapshot from `AppConfigSourceDotenv` + `AppConfigResolverEnv`. Environment
   only, and the only config there is until something can write logs: everything read off it is
   infrastructure needed BEFORE a database can be reached — where to log, and how to connect.
2. Constructs the process-level `RotatingLogStore` (before any container exists) and publishes it
   through `setLogStore`. A malformed `LOG_MAX_*` value fails loudly here, naming the variable,
   rather than surfacing later as a silently empty logs directory — see
   [setting.numbers.ts](src/modules/shared/setting.numbers.ts).
3. Builds the `DeadairLogger` over that store, so every module's lines land on stdout and in `logs/`.
4. Builds the **real** config store: the same dotenv layer plus
   [settings.config.source.ts](src/server/settings.config.source.ts) over `deadair.settings`, and
   publishes it through `setConfigStore`. This is what makes `config.get('playout.airMode')` work
   from a singleton with no DI scope, and it holds a `LISTEN` so a row edited by psql applies live.
5. Calls `scrubProcessEnv()`, which removes secret values from `process.env` now that both snapshots
   hold what they need. **After both builds, deliberately** — the settings source was handed
   resolved literal credentials precisely so it survives this; one still resolving `${env:…}` would
   connect once and fail every reload after, silently. See
   [scrub.process.env.ts](src/server/scrub.process.env.ts).
6. Runs `serverBuilder.setup(configStore.toLiveConfig(), logger, modules)` and mounts middleware and
   routers. The config handed to modules is a live view, so every read resolves against the current
   snapshot rather than a copy taken at boot.
7. Listens on `PORT`, read from the boot snapshot.

Modules that do I/O the first request doesn't depend on do it in `ready()`, after the socket is up:
plugin `init` is the current example.

### DI scoping convention

- **Scoped** (per request) when the class reads the request's `AuthorizationContext` or the
  per-request DB connection: auth services and factor repositories, `MusicService`s,
  `OnboardingService`, `PlaylistsService`, `PluginsService`, `PluginConfigService`.
- **Singleton** when there is exactly one of the thing for the process: `PluginRegistry`,
  `PluginInvoker` (its circuit breaker only means anything with shared failure counts), `PluginLog`,
  `PluginOAuthStateStore`, the Kysely pool and Redis client.

---

## Modules

Registered in the order below (see [modules.ts](src/modules/modules.ts)).

### Chassis

| Module             | Path                                                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data**           | [modules/data](src/modules/data)                     | The Kysely/Postgres pool and the Redis client. When `DATABASE_APP_USER` is set the runtime pool connects as the non-owner `app_user` role, which holds DML grants only and cannot alter the schema; dbmate and pg-boss keep their own owner connections via `DATABASE_USER`. The role is `nobypassrls` and there are no RLS policies for it not to bypass — see [row-level-security.md](../../docs/todo/row-level-security.md). Pool size and acquire/idle timeouts are tunable (`DATABASE_POOL_*`) because each request holds a connection for its whole lifetime. Also the generated DB types (`db.ts`) and the shared `DataRepository` base.                                                |
| **Crypto**         | [modules/crypto](src/modules/crypto)                 | The `EncryptionProvider`, keyed from `KMS_LOCAL_ROOT_KEY`. Registered before authentication so anything needing envelope encryption (auth factors, plugin credentials) resolves it without depending on auth's setup order.                                                                                                                                                                                                                                                                                                                                          |
| **Authentication** | [modules/authentication](src/modules/authentication) | Wires `@maroonedsoftware/authentication`: the bearer/JWT scheme handler and deadair's JWT issuer, factor services and Kysely repositories (password, email, phone, OIDC, FIDO, authenticator), MFA challenge and orchestration, Redis-backed rate limiting on password attempts, sessions and login-activity tracking, and the request/response cookie jars used by refresh-cookie flows. Google OIDC registers only when its client id and secret are configured. `OTP_DEV_BYPASS` accepts any submitted code and hard-fails at boot unless `NODE_ENV=development`. |
| **Permissions**    | [modules/permissions](src/modules/permissions)       | The Zanzibar-style tuple store and check path: `PermissionsService`, the Kysely `DeadairPermissionsTupleRepository`, the per-request `AuthorizationContext`, and `AccessControlService`. The authorization model in `generated/` is compiled from [data/permissions/core.perm](data/permissions/core.perm). `platform.roles.ts` holds the role → permission-pattern map that Zanzibar can't express per-object; its header documents the invariant that every role there must have a matching relation in the `.perm` file.                                          |
| **Policy**         | [modules/policy](src/modules/policy)                 | The concrete `PolicyService` and the policy registry map (`policy.mappings.ts`), including the MFA-satisfied and recent-factor policies that gate step-up-sensitive routes.                                                                                                                                                                                                                                                                                                                                                                                          |

### Domain

| Module         | Path                                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Catalog**    | [modules/catalog](src/modules/catalog)       | The local catalog: artists, albums and tracks, each a service over a Kysely repository, plus the ingest side under [ingest/](src/modules/catalog/ingest) (sync, resolution, placeholders). Reads join the display names in, exclude rows carrying `merged_into_id`, and order by name. Provider integration is not here — providers are plugins.                                                                                               |
| **Onboarding** | [modules/onboarding](src/modules/onboarding) | First-run requirements. Currently one: if no platform admin exists, `admin.account` is returned and satisfying it registers the genesis admin through `AuthenticationRegistrationService`. Database creation and migration stay out of band via dbmate.                                                                                                                                                                                        |
| **Settings**   | [modules/settings](src/modules/settings)     | The `deadair.settings` key/value table, declared as `ConfigField`s in `settings.registry.ts` so one console component renders both these and a plugin's. Also a layer of `AppConfig`, so a module reads a setting with no DI scope. The music-provider surface that used to live here moved to the plugin config system; there is no setting naming an active provider, and where a capability must pick one plugin the key is capability-scoped (`render.speechPluginId`, `llm.pluginId`, `analysis.pluginId`).                                                                                                                                                                                                                |
| **Plugins**    | [modules/plugins](src/modules/plugins)       | The plugin subsystem — see below.                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Playlists**  | [modules/playlists](src/modules/playlists)   | A read-only, no-database view of what could be imported from a plugin: every catalog-capable plugin's playlists, aggregated, plus one plugin's playlist tracks on demand. Nothing is persisted; every answer is a live call through `PluginInvoker`, and a failing plugin degrades to a `CatalogSourceError` entry rather than failing the request. Registered after `PluginsModule` because it resolves `PluginRegistry` and `PluginInvoker`. |
| **Logging**    | [src/logging](src/logging)                   | Owns the shutdown of the process-level `RotatingLogStore`. Must stay **first** in `modules.ts` so it tears down **last**: every other module's shutdown logging has to flush through `DeadairLogger` before the store closes.                                                                                                                                                                                                                                             |

### The plugin subsystem

[modules/plugins](src/modules/plugins) is registered late, because a plugin's host reaches into the
database, the encryption provider and the logger, and nothing in the chassis reaches back. The
contract itself is documented in [packages/plugin-sdk/README.md](../../packages/plugin-sdk/README.md);
the boundary rationale is in [docs/decisions/plugin-isolation.md](../../docs/decisions/plugin-isolation.md).

| Piece                                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin.loader.ts`                                | Discovers plugin directories: the bundled ones (`plugins.bundled.ts`) plus operator-installed ones under `PLUGINS_DIR` (default `./data/plugins`). Validates manifests and API version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `plugin.registry.ts`                              | The host's record of what is loaded and running. Singleton by necessity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `plugin.lifecycle.manager.ts`                     | `discoverAll()` in `start` (disk-only, and the HTTP surface needs the catalogue before it serves), `initAllEnabled()` in `ready` (where a plugin talks to its upstream, so an unreachable Spotify delays nothing and fails nobody but itself), `disposeAll()` on shutdown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `plugin.invoker.ts`                               | The only way host code calls plugin code: a 15s deadline per call (overridable per call, and published as the ambient deadline by `plugin.invocation.deadline.ts`) and a circuit breaker that quarantines a plugin after 3 consecutive failures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `plugin.host.factory.ts`                          | Builds the `PluginHost` handed to each plugin (`fetch` with its allowlist, budget and redirect cap, storage, config, events, logger), scoped to that plugin. One `host.fetch` runs against a single wall-clock budget, defaulting to `PLUGIN_FETCH_TIMEOUT_MS` and clamped to whatever the invocation it runs inside has left (`plugin.invocation.deadline.ts`, falling back to `PLUGIN_INVOKE_TIMEOUT_MS` outside one): rate-limit parking, the request, a `Retry-After` back-off and the retry all spend from it. Pacing is per allowlist entry (per `bucket`, where entries name one) rather than per plugin, at the rate that entry declared and capped by `PLUGIN_FETCH_REQUESTS_PER_WINDOW`. A `{ fromConfig }` entry resolves its hostname from the plugin's config on first use and is memoized for the life of the host, which cannot go stale because a config write reinitializes the plugin. Requests carry a `User-Agent` naming the plugin unless the plugin set one itself. Everything it throws is a `PluginError`, never a `ServerkitError`: these are thrown into plugin code, and anything the invoker's `toPluginError` does not recognize is flattened to `internal` and answers 500 whatever the host meant by it. |
| `plugin.log.ts`                                   | Tees each plugin's output to the app logger and to its own rotating file, with a per-plugin verbosity gate that only applies to the file sink.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `plugin.config.*`, `plugin.storage.repository.ts` | Per-plugin config and key/value storage, with secret fields envelope-encrypted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `plugin.oauth.state.store.ts`                     | Mints and redeems the OAuth `state`. The callback route is necessarily anonymous, so `state` is the only thing separating a real callback from a forged rebind of the station's music source. Deliberately the host's check, not the plugin's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `plugin.error.http.ts`                            | Maps a `PluginError` onto an HTTP response without leaking host internals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

---

## Routes

Routers are registered in [routes.setup.ts](src/routes/routes.setup.ts) and are generated by
ContractKit from the `.ck` contracts under [data/contracts](data/contracts) (`pnpm build:contracts`).
Never hand-edit a router.

| Router                    | Paths                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authentication`          | `POST /auth/login/start`, `/auth/login/verify`, `/auth/login/register`, `/auth/token`, `/auth/mfa/start`, `GET /auth/login/oidc/callback`, `GET /auth/login/link/redirect`                                                                                                                                                                                                                                         |
| `authentication.factor`   | `GET /auth/factors`, `POST /auth/factors/register`, `/auth/factors/start`, `/auth/factors/verify`, `DELETE /auth/factors/:method/:methodId` (authenticator only, behind a recent strong factor)                                                                                                                                                                                                                                                                                                                  |
| `authentication.sessions` | `POST /auth/logout` — anonymous by design: signing out must always clear the httpOnly refresh cookie, including for a caller whose access token has already expired                                                                                                                                                                                                                                                |
| `catalog`                 | `GET /catalog/artists`, `/catalog/artists/:id`, `/catalog/artists/:id/albums`, `/catalog/albums`, `/catalog/albums/:id`, `/catalog/albums/:id/tracks`, `/catalog/tracks`                                                                                                                                                                                                                                           |
| `onboarding`              | `GET /onboarding`, `POST /onboarding`                                                                                                                                                                                                                                                                                                                                                                              |
| `playlists`               | `GET /playlists`, `GET /playlists/:pluginId/:playlistId/tracks`                                                                                                                                                                                                                                                                                                                                                    |
| `playout`                 | `GET /playout/status`, `POST /playout/playlist`, `/playout/start`, `/playout/skip`, `/playout/stop` (stand the station down: out of service, not merely paused), and `GET /playout/audio/:sourceId`, which is how the player fetches every record — one URL on this machine whether or not the bytes are here yet. Internal and secret-gated by the `/playout/bridge/` prefix, never in the SDK: `POST /playout/bridge/aired` (Liquidsoap's air confirmation) and `POST /playout/bridge/starve`. There is no listener hook: Icecast's `listener_add`/`listener_remove` are gone along with `listener.credential.middleware`, and the audience is read from the event feed and the stats poll instead — see the audience gate in `stream/README.md` |
| `director`                | `GET /director/lineups`, `POST /director/lineups`, `GET`/`DELETE /director/lineups/:id`, `POST /director/lineups/:id/extend`, `/director/lineups/:id/shuffle`, `PATCH`/`DELETE /director/lineups/:id/items/:itemId`, `GET`/`POST /director/air`, `PATCH /director/air` (what puts the station on air: `audience` or `always`)                                                                                      |
| `nowplaying`              | `GET /nowplaying`, deliberately public and transaction-exempt: it answers out of memory and says only what a listener can already hear, plus how many of them there are                                                                                                                                                                                                                                            |
| `plugins`                 | `GET /plugins`, `/plugins/:id`, `POST /plugins/rescan`, `/plugins/:id/enable`, `/plugins/:id/disable`, `/plugins/:id/reload`, `/plugins/:id/test`, `PUT /plugins/:id/config`; logs at `GET /plugins/:id/logs`, `/plugins/:id/logs/download`, `PUT /plugins/:id/logs/level`; OAuth at `GET /plugins/:id/oauth/authorize`, `GET /plugins/:id/oauth/callback`, `DELETE /plugins/:id/oauth`                            |

**The table above is a partial list and is not kept in step with the tree** — it omits roughly half
the registered routers. [routes.setup.ts](src/routes/routes.setup.ts) is the source of truth, and
`health` is deliberately first in it, answering `/` and `/healthcheck` out of memory (both are
transaction-exempt for that reason).

### Server middleware

Assembled in [setup.middleware.ts](src/server/setup.middleware.ts), in order: error handling,
ServerKit context, Redis rate limiting (100 requests / 5s, with an in-memory `insuranceLimiter` so a
Redis blip fails open rather than 429-ing the whole API), credentialed CORS against the explicit
`SPA_BASE_URL` / `APP_BASE_URL` origins, authentication, audit context, authorization context, and
the refresh-cookie hook.

Three of those carry most of the weight:

- **[rate.limit](src/server/middleware/rate.limit.middleware.ts)** is ours rather than ServerKit's,
  and the difference is only the key. ServerKit's uses `ctx.ip`, which behind nginx is the edge —
  one bucket for every browser at once, so a burst from one console page spends everyone's budget.
  Set `TRUST_PROXY=true` (dotenv, off by default) and the key comes from `X-Real-IP`, or the LAST
  hop of `X-Forwarded-For` where the edge does not set one; the last, because nginx appends and the
  first entry is whatever the client wrote. Turning it on is a statement that nothing that matters
  can reach the API around the proxy, since a forwarded header from a direct caller is a free bucket
  per address they invent. Liquidsoap is a direct caller by design (see `playout.urls.ts`) and keeps
  its own peer address either way. The switch itself lives in
  [request.trust.ts](src/modules/shared/request.trust.ts), because the refresh cookie reads it too:
  whether to mark itself `secure` is the same question about the same edge, and the answer is taken
  from `X-Forwarded-Proto` (leftmost hop, the browser's own) rather than from `NODE_ENV`. It was the
  environment for as long as it existed, which is a claim about the build and not about the
  connection — and the bundled image serves over plain HTTP, so the cookie jar refused the `secure`
  cookie outright. Both writes of that cookie are error paths (clear a dead token after a 401), so
  the refusal turned every expired session into a 500 that also failed to clear the cookie, which the
  browser then presented again forever.

- **[audit.context](src/server/middleware/audit.context.middleware.ts)** opens the per-request
  transaction, sets the `app.actor_*` GUCs on it (a prepared seam — nothing reads them yet), and
  overrides the scoped `Kysely` and pg-boss connection provider so job enqueues commit atomically
  with the request. GETs run in a transaction too, so `AfterCommit` means what it says on every
  route and a read path that enqueues something still gets that atomicity.
- **[authorization.context](src/server/middleware/authorization.context.middleware.ts)** collapses
  the auth package's flat context into deadair's `Actor` union and resolves the actor's platform
  roles into a permission set.

[transaction.exemptions.ts](src/server/middleware/transaction.exemptions.ts) makes the opt-out set
declarative: OPTIONS preflight, `/`, `/healthcheck`, streaming responses, cached cover art,
now-playing, and the four routes whose holding time is set by a language model or a speech engine
rather than by the station (drafting a persona, rehearsing one, a voice sample, a speech preview).
Its header documents the bar a new exemption has to clear: an exempt request has no transaction, so
it must not enqueue a job describing work that could still fail, and must not rely on `AfterCommit`
for anything a caller reads back in the same request. The last four clear a second bar as well,
which is why they are exempt rather than merely slow: not one of them writes anything a transaction
could have rolled back.

---

## Common commands

```bash
pnpm --filter @deadair/api dev
```

```bash
pnpm --filter @deadair/api test
```

```bash
pnpm --filter @deadair/api migrate:up
```

`build:contracts` regenerates routers/types from `data/contracts`; `build:permissions` regenerates
the authorization model from `data/permissions`; `build:datatypes` runs the enum override sync then
`kysely-codegen`; `rebuild:data` rolls the schema all the way down and back up.

`typecheck` is two passes — `typecheck:tests` (`tsconfig.tests.json`) and `typecheck:scripts`
(`scripts/tsconfig.json`) — so `tests/` and the dev scripts are both held to the same bar as `src/`,
while `build` (`tsc`) still covers only shippable `src`. Run it after changing a constructor or an
exported signature: vitest transpiles without checking types and the scripts have no runner at all,
so neither folder tells you it has drifted until this does.

`scripts/` holds the smoke tools, which drive the real services against the running stack rather than
stubs: `silence.smoke.ts` (why the station is quiet, `--blind` to fake an unreachable Icecast without
touching a container), `playout.smoke.ts` (airs an ident to the mount), `stream.config.smoke.ts`
(renders the container config through `StreamService`), `rating.smoke.ts` (the rating SQL, which
nothing else covers) and `verify.speech.ts` (a real mp3 out of a real Kokoro). Each carries its own
run line in its header.
