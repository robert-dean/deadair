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
placement).

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
scripts/            rollbackall.sh, enum-override sync
tests/              vitest suites, mirroring src/
```

Import aliases are declared as `paths` in [tsconfig.json](tsconfig.json) (not `package.json#imports`)
and mirrored for the runtime in [vitest.config.ts](vitest.config.ts): `#src/*`, `#routes/*`,
`#modules/*`, `#shared/*`. Note that `#shared/*` maps to `src/shared`, which does not exist — shared
types live under `src/modules/shared` and are imported by relative path. Local imports carry `.js`
extensions.

### Boot sequence

`setupServer()` ([src/server/setup.server.ts](src/server/setup.server.ts)):

1. Builds one `AppConfig` snapshot from `AppConfigSourceDotenv` + `AppConfigResolverEnv`. There is
   no DB-backed config source yet: everything is env at boot.
2. Calls `scrubProcessEnv()`, which removes secret values from `process.env` now that module setups
   read the snapshot instead. See [scrub.process.env.ts](src/server/scrub.process.env.ts) for what
   this does and does not buy.
3. Constructs the process-level `RotatingLogStore` (before any container exists) and publishes it
   through `setLogStore`. A malformed `LOG_MAX_*` value fails loudly here rather than surfacing
   later as a silently empty logs directory.
4. Runs `serverBuilder.setup(config, new FileTeeLogger(...), modules)`, mounts middleware and
   routers, then listens on `PORT`.

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

| Module | Path | What it does |
| --- | --- | --- |
| **Data** | [modules/data](src/modules/data) | The Kysely/Postgres pool and the Redis client. When `DATABASE_APP_USER` is set the runtime pool connects as the non-owner `app_user` role so the org-isolation RLS policies actually enforce (the table owner bypasses RLS); dbmate and pg-boss keep their own owner connections via `DATABASE_USER`. Pool size and acquire/idle timeouts are tunable (`DATABASE_POOL_*`) because each request holds a connection for its whole lifetime. Also the generated DB types (`db.ts`) and the shared `DataRepository` base. |
| **Crypto** | [modules/crypto](src/modules/crypto) | The `EncryptionProvider`, keyed from `KMS_LOCAL_ROOT_KEY`. Registered before authentication so anything needing envelope encryption (auth factors, plugin credentials) resolves it without depending on auth's setup order. |
| **Authentication** | [modules/authentication](src/modules/authentication) | Wires `@maroonedsoftware/authentication`: the bearer/JWT scheme handler and deadair's JWT issuer, factor services and Kysely repositories (password, email, phone, OIDC, FIDO, authenticator), MFA challenge and orchestration, Redis-backed rate limiting on password attempts, sessions and login-activity tracking, and the request/response cookie jars used by refresh-cookie flows. Google OIDC registers only when its client id and secret are configured. `OTP_DEV_BYPASS` accepts any submitted code and hard-fails at boot unless `NODE_ENV=development`. |
| **Permissions** | [modules/permissions](src/modules/permissions) | The Zanzibar-style tuple store and check path: `PermissionsService`, the Kysely `DeadairPermissionsTupleRepository`, the per-request `AuthorizationContext`, and `AccessControlService`. The authorization model in `generated/` is compiled from [data/permissions/core.perm](data/permissions/core.perm). `platform.roles.ts` holds the role → permission-pattern map that Zanzibar can't express per-object; its header documents the invariant that every role there must have a matching relation in the `.perm` file. |
| **Policy** | [modules/policy](src/modules/policy) | The concrete `PolicyService` and the policy registry map (`policy.mappings.ts`), including the MFA-satisfied and recent-factor policies that gate step-up-sensitive routes. |

### Domain

| Module | Path | What it does |
| --- | --- | --- |
| **Catalog** | [modules/catalog](src/modules/catalog) | The local catalog: artists, albums and tracks, each a service over a Kysely repository, plus the ingest side under [ingest/](src/modules/catalog/ingest) (sync, resolution, placeholders). Reads join the display names in, exclude rows carrying `merged_into_id`, and order by name. Provider integration is not here — providers are plugins. |
| **Onboarding** | [modules/onboarding](src/modules/onboarding) | First-run requirements. Currently one: if no platform admin exists, `admin.account` is returned and satisfying it registers the genesis admin through `AuthenticationRegistrationService`. Database creation and migration stay out of band via dbmate. |
| **Settings** | [modules/settings](src/modules/settings) | The `deadair.settings` key/value table. Deliberately thin right now: the music-provider surface that used to live here moved to the plugin config system, and the active provider is named by the `music.provider` setting key. |
| **Plugins** | [modules/plugins](src/modules/plugins) | The plugin subsystem — see below. |
| **Playlists** | [modules/playlists](src/modules/playlists) | A read-only, no-database view of what could be imported from a plugin: every catalog-capable plugin's playlists, aggregated, plus one plugin's playlist tracks on demand. Nothing is persisted; every answer is a live call through `PluginInvoker`, and a failing plugin degrades to a `CatalogSourceError` entry rather than failing the request. Registered after `PluginsModule` because it resolves `PluginRegistry` and `PluginInvoker`. |
| **Logging** | [src/logging](src/logging) | Owns the shutdown of the process-level `RotatingLogStore`. Must stay **last** in `modules.ts`: every other module's shutdown logging has to flush through `FileTeeLogger` before the store closes. |

### The plugin subsystem

[modules/plugins](src/modules/plugins) is registered late, because a plugin's host reaches into the
database, the encryption provider and the logger, and nothing in the chassis reaches back. The
contract itself is documented in [packages/plugin-sdk/README.md](../../packages/plugin-sdk/README.md);
the boundary rationale is in [docs/decisions/plugin-isolation.md](../../docs/decisions/plugin-isolation.md).

| Piece | What it does |
| --- | --- |
| `plugin.loader.ts` | Discovers plugin directories: the bundled ones (`plugins.bundled.ts`) plus operator-installed ones under `PLUGINS_DIR` (default `./data/plugins`). Validates manifests and API version. |
| `plugin.registry.ts` | The host's record of what is loaded and running. Singleton by necessity. |
| `plugin.lifecycle.manager.ts` | `discoverAll()` in `start` (disk-only, and the HTTP surface needs the catalogue before it serves), `initAllEnabled()` in `ready` (where a plugin talks to its upstream, so an unreachable Spotify delays nothing and fails nobody but itself), `disposeAll()` on shutdown. |
| `plugin.invoker.ts` | The only way host code calls plugin code: a 15s deadline per call and a circuit breaker that quarantines a plugin after 3 consecutive failures. |
| `plugin.host.factory.ts` | Builds the `PluginHost` handed to each plugin (`fetch` with its allowlist, budget and redirect cap, storage, config, events, logger), scoped to that plugin. One `host.fetch` runs against a single wall-clock budget, defaulting to `PLUGIN_FETCH_TIMEOUT_MS` and clamped to `PLUGIN_INVOKE_TIMEOUT_MS`: rate-limit parking, the request, a `Retry-After` back-off and the retry all spend from it. Everything it throws is a `PluginError`, never a `ServerkitError`: these are thrown into plugin code, and anything the invoker's `toPluginError` does not recognize is flattened to `internal` and answers 500 whatever the host meant by it. |
| `plugin.log.ts` | Tees each plugin's output to the app logger and to its own rotating file, with a per-plugin verbosity gate that only applies to the file sink. |
| `plugin.config.*`, `plugin.storage.repository.ts` | Per-plugin config and key/value storage, with secret fields envelope-encrypted. |
| `plugin.oauth.state.store.ts` | Mints and redeems the OAuth `state`. The callback route is necessarily anonymous, so `state` is the only thing separating a real callback from a forged rebind of the station's music source. Deliberately the host's check, not the plugin's. |
| `plugin.error.http.ts` | Maps a `PluginError` onto an HTTP response without leaking host internals. |

---

## Routes

Routers are registered in [routes.setup.ts](src/routes/routes.setup.ts) and are generated by
ContractKit from the `.ck` contracts under [data/contracts](data/contracts) (`pnpm build:contracts`).
Never hand-edit a router.

| Router | Paths |
| --- | --- |
| `authentication` | `POST /auth/login/start`, `/auth/login/verify`, `/auth/login/register`, `/auth/token`, `/auth/mfa/start`, `GET /auth/login/oidc/callback`, `GET /auth/login/link/redirect` |
| `authentication.factor` | `GET /auth/factors`, `POST /auth/factors/register`, `/auth/factors/start`, `/auth/factors/verify` |
| `authentication.sessions` | `POST /auth/logout` — anonymous by design: signing out must always clear the httpOnly refresh cookie, including for a caller whose access token has already expired |
| `catalog` | `GET /catalog/artists`, `/catalog/artists/:id`, `/catalog/artists/:id/albums`, `/catalog/albums`, `/catalog/albums/:id`, `/catalog/albums/:id/tracks`, `/catalog/tracks` |
| `onboarding` | `GET /onboarding`, `POST /onboarding` |
| `playlists` | `GET /playlists`, `GET /playlists/:pluginId/:playlistId/tracks` |
| `plugins` | `GET /plugins`, `/plugins/:id`, `POST /plugins/rescan`, `/plugins/:id/enable`, `/plugins/:id/disable`, `/plugins/:id/reload`, `/plugins/:id/test`, `PUT /plugins/:id/config`; logs at `GET /plugins/:id/logs`, `/plugins/:id/logs/download`, `PUT /plugins/:id/logs/level`; OAuth at `GET /plugins/:id/oauth/authorize`, `GET /plugins/:id/oauth/callback`, `DELETE /plugins/:id/oauth` |

There is no healthcheck router registered here yet, though `/` and `/healthcheck` are already listed
as transaction-exempt paths.

### Server middleware

Assembled in [setup.middleware.ts](src/server/setup.middleware.ts), in order: error handling,
ServerKit context, Redis rate limiting (100 requests / 5s, with an in-memory `insuranceLimiter` so a
Redis blip fails open rather than 429-ing the whole API), credentialed CORS against the explicit
`SPA_BASE_URL` / `APP_BASE_URL` origins, authentication, audit context, authorization context, and
the refresh-cookie hook.

Two of those carry most of the weight:

- **[audit.context](src/server/middleware/audit.context.middleware.ts)** opens the per-request
  transaction, sets the `app.actor_*` GUCs on it, and overrides the scoped `Kysely` and pg-boss
  connection provider so job enqueues commit atomically with the request. GETs run in a transaction
  too, because the org-isolation GUC is set `is_local` and would otherwise expire after one
  statement.
- **[authorization.context](src/server/middleware/authorization.context.middleware.ts)** collapses
  the auth package's flat context into deadair's `Actor` union and resolves the actor's platform
  roles into a permission set.

[transaction.exemptions.ts](src/server/middleware/transaction.exemptions.ts) makes the opt-out set
declarative (OPTIONS preflight, `/`, `/healthcheck`, streaming responses). Its header documents the
bar a new exemption has to clear: an exempt request has no transaction, so it must not rely on the
org-isolation RLS policies.

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
`kysely-codegen`; `rebuild:data` rolls the schema all the way down and back up. `typecheck` uses
`tsconfig.tests.json` so tests are checked too, while `build` (`tsc`) covers only shippable `src`.
