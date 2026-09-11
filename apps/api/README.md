# @deadair/api

The deadair API: a Koa server (via `@maroonedsoftware/koa` "ServerKit"), and the radio station's
brain. It serves the console's JSON API, hosts the plugin system that music providers, enrichment
sources, speech engines and models plug into, and runs the station actors themselves — the director
that owns the running order, the render pipeline that writes and speaks what the presenter says
between records, the transport that hands it all to the player, and the now-playing answer over the
top. **No decoding, mixing or encoding happens in Node**: Liquidsoap and Icecast do that, running as
sibling containers from the repo-root compose files, and the measurement sidecar under `analysis/`
is a separate process for the same reason. Node does write segment audio, and serves it back over
HTTP for Liquidsoap to fetch.

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

Registered first, in this order, and the order is load-bearing — see the comments in
[modules.ts](src/modules/modules.ts).

| Module              | Path                                                 | What it does |
| ------------------- | ---------------------------------------------------- | ------------ |
| **Logging**         | [src/logging](src/logging)                           | Owns the shutdown of the process-level `RotatingLogStore`, which `setup.server.ts` builds before any container exists. Registers, starts and readies nothing. Must stay **first** so it tears down **last**: every other module's shutdown logging has to flush through `DeadairLogger` before the store closes. |
| **DataConnections** | [modules/data](src/modules/data)                     | Closes the Postgres pool and the Redis client, and nothing else — registration stays in **Data**. Second so it tears down second-to-last: the pools must outlive every module that writes during its own teardown. With the close left in Data's own position, the director's flush of the running order was lost on nine of this install's shutdowns. |
| **Health**          | [modules/health](src/modules/health)                 | Liveness, and the first module that registers anything. It depends on nothing, so a probe asking whether the process is up while everything below is still starting gets the true answer rather than a 404 that reads as a wrong URL. |
| **Data**            | [modules/data](src/modules/data)                     | The Kysely/Postgres pool and the Redis client. When `DATABASE_APP_USER` is set the runtime pool connects as the non-owner `app_user` role, which holds DML grants only and cannot alter the schema; dbmate and pg-boss keep their own owner connections via `DATABASE_USER`. The role is `nobypassrls` and there are no RLS policies for it not to bypass — see [row-level-security](https://github.com/robert-dean/deadair/discussions/31). Pool size and acquire/idle timeouts are tunable (`DATABASE_POOL_*`) because each request holds a connection for its whole lifetime. Also the generated DB types (`db.ts`) and the shared `DataRepository` base. |
| **Crypto**          | [modules/crypto](src/modules/crypto)                 | The `EncryptionProvider`, keyed from `KMS_LOCAL_ROOT_KEY`. Registered before authentication so anything needing envelope encryption (auth factors, plugin credentials) resolves it without depending on auth's setup order. |
| **Authentication**  | [modules/authentication](src/modules/authentication) | Wires `@maroonedsoftware/authentication`: the bearer/JWT scheme handler and deadair's JWT issuer, factor services and Kysely repositories (password, email, phone, OIDC, FIDO, authenticator), MFA challenge and orchestration, Redis-backed rate limiting on password attempts, sessions and login-activity tracking, and the request/response cookie jars used by refresh-cookie flows. Google OIDC registers only when its client id and secret are configured. `OTP_DEV_BYPASS` accepts any submitted code and hard-fails at boot unless `NODE_ENV=development`. |
| **Permissions**     | [modules/permissions](src/modules/permissions)       | The Zanzibar-style tuple store and check path: `PermissionsService`, the Kysely `DeadairPermissionsTupleRepository`, the per-request `AuthorizationContext`, and `AccessControlService`. The authorization model in `generated/` is compiled from [data/permissions/core.perm](data/permissions/core.perm). `platform.roles.ts` holds the role → permission-pattern map that Zanzibar can't express per-object; its header documents the invariant that every role there must have a matching relation in the `.perm` file. |
| **Policy**          | [modules/policy](src/modules/policy)                 | The concrete `PolicyService` and the policy registry map (`policy.mappings.ts`). `auth.session.mfa.required` is the package's default rule, which is what makes a sign-in stop at a challenge for an account with an authenticator enrolled; `auth.session.recent.factor` gates enrolling and removing factors once a strong one exists; `auth.session.mfa.satisfied` is deliberately always-allow, since nothing evaluates it. |

### Domain

The rest, in registration order. A module's position is a dependency order read forwards and a
teardown order read backwards; where one of those is the reason it sits where it does, the cell says
so.

| Module          | Path                                             | What it does |
| --------------- | ------------------------------------------------ | ------------ |
| **Art**         | [modules/art](src/modules/art)                   | Locally cached artwork: the files, and the rows saying what is in them. Before Catalog, whose reads join `art_assets` so a row with a cached cover reports that instead of the upstream URL. `art_assets` is keyed by `source_url` and treats it as the image's IDENTITY, so a provider minting a per-call URL never hits the cache and quietly fills the disk. Caching is not a credential firewall: until a fetch succeeds, reads hand out the upstream URL verbatim. |
| **Catalog**     | [modules/catalog](src/modules/catalog)           | The local catalog: artists, albums and tracks, each a service over a Kysely repository, plus the ingest side under [ingest/](src/modules/catalog/ingest) (sync, resolution, placeholders). Reads join the display names in, exclude rows carrying `merged_into_id`, and order by name. Provider integration is not here — providers are plugins. |
| **Onboarding**  | [modules/onboarding](src/modules/onboarding)     | First-run requirements. Currently one: if no platform admin exists, `admin.account` is returned and satisfying it registers the genesis admin through `AuthenticationRegistrationService`. Database creation and migration stay out of band via dbmate. |
| **Settings**    | [modules/settings](src/modules/settings)         | The `deadair.settings` key/value table, declared as `ConfigField`s in `settings.registry.ts` so one console component renders both these and a plugin's. Also a layer of `AppConfig`, so a module reads a setting with no DI scope. The music-provider surface that used to live here moved to the plugin config system; there is no setting naming an active provider, and where a capability must pick one plugin the key is capability-scoped (`render.speechPluginId`, `llm.pluginId`, `analysis.pluginId`). |
| **Stream**      | [modules/stream](src/modules/stream)             | The Icecast and Liquidsoap configuration, rendered from the `stream.*` settings onto a shared volume for containers that cannot read the database, plus the track fetcher's one-time Spotify authorization, the Icecast event feed and stats clients, and the HLS playlists. Renders in `ready()` rather than `start()`: a failure costs the containers their newest config, not the app its socket. Both read their config once at startup, so a `stream.*` change means a restart either way. |
| **Plugins**     | [modules/plugins](src/modules/plugins)           | The plugin subsystem — see below. After everything its host reaches into. |
| **Jobs**        | [modules/jobs](src/modules/jobs)                 | The pg-boss broker, runner and cron mappings, on the OWNER connection because pg-boss migrates its own schema. After Plugins, and it is teardown that fixes the position: registering here is what stops the workers consuming before the plugin instances under them are disposed. A failed `start()` sets `process.exitCode = 1` and sends itself `SIGTERM` rather than letting boot carry on with nothing consuming the director's rows. |
| **Playlists**   | [modules/playlists](src/modules/playlists)       | A read-only, no-database view of what could be imported from a plugin: every catalog-capable plugin's playlists, aggregated, plus one plugin's playlist tracks on demand. Nothing is persisted; every answer is a live call through `PluginInvoker`, and a failing plugin degrades to a `CatalogSourceError` entry rather than failing the request. |
| **Charts**      | [modules/charts](src/modules/charts)             | What is popular, out of whatever chart plugins are installed. A menu rather than a merge: two services' top forties are two published documents, so it enumerates and never combines. It starts nothing — a chart is fetched because something asked, never because time passed. |
| **Similarity**  | [modules/similarity](src/modules/similarity)     | Who else sounds like this, out of whatever similarity plugins are installed. Charts' sibling, in the same position and for the same reasons. One says what is popular and the other who sounds alike, and both answer in names the pick path judges. |
| **News**        | [modules/news](src/modules/news)                 | What happened outside the station, out of whatever news plugins are installed. A menu rather than a merge, exactly like Charts: two news services are two newsrooms. Its `ready()` seeds the news categories on a station that has none, never fatally. Nothing here polls — the loop a breaking-news break would need belongs to whatever posts the break. |
| **Search**      | [modules/search](src/modules/search)             | What the open web says, out of whatever search plugins are installed. News's other half: one serves a menu the operator assembled, the other takes a question nobody wrote down in advance. Nothing here polls, and nothing here can put a result on air. |
| **Weather**     | [modules/weather](src/modules/weather)           | What it is like outside, and the one of these three that answers about a PLACE: read by the LLM as a tool the presenter can call mid-sentence, and by the director as the substrate of a weather break. It holds no cache of its own — the window a reading may be reused for belongs to the plugin, the only party that knows how often its service publishes. |
| **Topics**      | [modules/topics](src/modules/topics)             | What a break can be ABOUT: the operator's own vocabulary ("technology", "Atlanta"), per sort of break, plus the registry saying which kinds have subjects at all. That registry is an explicit list, exactly as the LLM's tool sources are — nothing scans and nothing self-registers. After News and Weather, which own the kinds. |
| **Scrobble**    | [modules/scrobble](src/modules/scrobble)         | Telling somebody else what the station played. Unlike its neighbours it SENDS, so its queue is durable — but it still starts nothing: the queue fills on a track boundary, which is the director's, and drains on a cron, which is the broker's. |
| **Llm**         | [modules/llm](src/modules/llm)                   | Asking a model for words: which plugin the station thinks with, the budget one generation gets, the single-slot gate and the tool loop — all host-side, so every writer behaves the same instead of each plugin getting it subtly different. The base URL, model, credentials and temperature are the plugin's config. Nothing here knows what a break is, and it starts nothing. |
| **Personas**    | [modules/personas](src/modules/personas)         | Who the station is when it opens its mouth: the character sheets, their notebooks, their stories and their auditions, and which one is on air. Read by Render for the voice a break is spoken in and by the director for the words underneath it. Its `ready()` seeds a station with no personas at all. Putting one on air reaches forward into the director at request time, which the list allows because it is a lifecycle order rather than a resolution one. |
| **Schedule**    | [modules/schedule](src/modules/schedule)         | The station's day, as something an operator writes: slots naming a playlist and a persona. After Playlists and Personas, whose rows a slot names; a slot stores ids and both readers resolve them at the moment of use, which is what lets a deleted persona fall back rather than fault. It owns no loop and starts nothing — the resolver lives beside the running order and the timer is a job. |
| **Render**      | [modules/render](src/modules/render)             | Segments: everything the station can play that is not a record — the rows, the content-addressed audio, the scripts behind them, the voices, the pronunciation lexicon and the pad rack. Before Playout, whose resolver answers for a committed segment by reading a row and a file from here. |
| **Playout**     | [modules/playout](src/modules/playout)           | The station's transport: the singleton rundown and the loop that drains it into Liquidsoap, plus the resolvers that turn an item into one URL on this machine. Almost everything here is a singleton by necessity — a per-request rundown would hand every caller a different, empty view of what is on air, and the pusher's reconcile loop would have nothing to drain. Its `ready()` reads the bridge secret Stream has already seeded. |
| **NowPlaying**  | [modules/nowplaying](src/modules/nowplaying)     | The station's public answer to "what are you playing". After Playout, whose singleton `Rundown` holds what is on air. It stores nothing and starts nothing: everything it reports is already kept by somebody else, or read straight off `AppConfig`. |
| **Analysis**    | [modules/analysis](src/modules/analysis)         | Measuring the catalog: a record's cue points and its loudness, through the analyzer plugin over the Python sidecar. It fetches the same audio the transport would play, through Playout's `CachedTrackResolver` and then its `PluginTrackResolver`, so a record the station has cached is measured from the file that will actually air. Before the director, whose `PickResolver` stamps the cue points onto the item it builds. |
| **Director**    | [modules/director](src/modules/director)         | The station's programming: the one running order it is airing, the actor that owns it, and the writers that produce what the presenter says between records. Sole writer of the rundown — see [director.md § Who owns the running order](../../docs/internals/director.md#who-owns-the-running-order) and the four bugs that were all the same bug — so anything changing what airs arrives as a command on `DirectorMailbox`. After Playout, Catalog, Playlists and Analysis. |
| **Storage**     | [modules/storage](src/modules/storage)           | How much disk the station is using and for what. Four content stores share one volume — records, cover art, the audio of everything the station has said, and the voice previews — and each belongs to a module that is right not to know what the others hold, so the reader across them is its own. After Art, Render and Playout, whose stores it resolves. It reports and never repairs: a file no row claims, and a row whose file has gone, both stay exactly as they are. |
| **Activity**    | [modules/activity](src/modules/activity)         | The console's activity feed, as one time-ordered list over three sources: `station_events`, which it owns, plus `segment_events` for a break's journey through the render pipeline and `play_history` for what aired. Neither of the other two is copied here, because a fact with two writers is two things that can disagree. Plugin call logs are deliberately not folded in: they sit on a `platform.manage` floor for a reason. |
| **History**     | [modules/history](src/modules/history)           | What the station has played, newest first, as one list a listener can scroll. It owns nothing: `play_history` is the director's, written from the rundown's `onAired`, and the cover and running time are the catalog's. After Activity, whose cursor helpers it reuses. |
| **Enrichment**  | [modules/enrichment](src/modules/enrichment)     | The walk that fans a record out across every enrichment plugin, merges what they said, and extracts out of it the facts the station states on air and the pronunciations it says them with. After Plugins for the registry and invoker, and after the director because `LineupPriorityReader` reads the running order to describe what is about to play first. It only READS that order; the director stays its one writer. |
| **Productions** | [modules/productions](src/modules/productions)   | What the station MAKES, as against what it says: phone-ins, beats, casting and stitching. A production's beats ARE segments, so making one goes through the render path's claims and content store, and a finished production reaches air only through the director. It owns no loop — a production is made entirely by jobs, one per pass, which is what makes a restart resumable and leaves the model slot free in between. |
| **Station**     | [modules/station](src/modules/station)           | The station about itself, composed across everything else: what needs somebody, and the machinery underneath it. Last, because it reads playout's silence diagnosis, the director's running order, the catalog's state and the plugin host, and nothing resolves it back. It owns no table and writes nothing. It is not a health check: several of the states it composes describe a healthy process doing what it was told, so only faults reach the list. |

### The plugin subsystem
[modules/plugins](src/modules/plugins) is registered late, because a plugin's host reaches into the
database, the encryption provider and the logger, and nothing in the chassis reaches back. The
contract itself is documented in
[packages/plugin-sdk/README.md](../../packages/plugin-sdk/README.md); the boundary rationale is in
[packages/plugin-sdk/CLAUDE.md](../../packages/plugin-sdk/CLAUDE.md) § "Trust and egress".

| Piece                                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin.loader.ts`                                | Discovers plugin directories: the bundled ones (`plugins.bundled.ts`) plus operator-installed ones under `PLUGINS_DIR` (default `./data/plugins`). Validates manifests and API version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `plugin.registry.ts`                              | The host's record of what is loaded and running. Singleton by necessity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `plugin.lifecycle.manager.ts`                     | `discoverAll()` in `start` (disk-only, and the HTTP surface needs the catalogue before it serves), `initAllEnabled()` in `ready` (where a plugin talks to its upstream, so an unreachable Spotify delays nothing and fails nobody but itself), `disposeAll()` on shutdown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `plugin.invoker.ts`                               | The only way host code calls plugin code: an 8s deadline per call (overridable per call, and published as the ambient deadline by `plugin.invocation.deadline.ts`) and a circuit breaker that quarantines a plugin after 3 consecutive failures, until a reinit or a healthy `probe` lifts it: the Test connection button, or the breaker's own recovery timer (1 minute, doubling to 30) after a failure retrying could end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
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

| Router                    | Paths |
| ------------------------- | ----- |
| `health`                  | `GET /health`, `GET /healthcheck` — the same answer under both spellings, anonymous and transaction-exempt, and internal, so no SDK method is generated |
| `authentication`          | `POST /auth/token`, `/auth/login/start`, `/auth/login/verify`, `/auth/login/register`; internal browser landings at `GET /auth/login/oidc/callback` and `GET /auth/login/link/redirect`. Anonymous throughout by necessity |
| `authentication.factor`   | `GET /auth/factors`, `POST /auth/factors/register`, `/auth/factors/verify`, `POST /auth/mfa/start`, `DELETE /auth/factors/:method/:methodId` (authenticator only, behind a recent strong factor). `POST /auth/factors/start` is the one route here with no session gate: it is authenticated by the short-lived `mfa_challenge_id` in the body |
| `authentication.sessions` | `POST /auth/logout` — anonymous by design: signing out must always clear the httpOnly refresh cookie, including for a caller whose access token has already expired. `GET /auth/session` reports who the caller is and which platform roles they hold |
| `art`                     | `GET /art/:id` — the bytes of one cached image, anonymous by necessity: this URL is the `src` of an image element and an image request carries no bearer token |
| `activity`                | `GET /activity` — the feed, newest first, one page at a time |
| `history`                 | `GET /history` — what the station played, newest first, one page at a time |
| `catalog`                 | Reads over `/catalog/artists`, `/catalog/albums` and `/catalog/tracks` (list, one, and `/albums`, `/tracks`, `/enrichment` under them), plus `PUT /catalog/{artists,albums,tracks}/:id/rating`. Per-track maintenance: `POST /catalog/tracks/:id/retry`, `/offer`, and `DELETE /catalog/tracks/:id/audio`, `/analysis`, `/enrichment` |
| `charts`                  | `GET /charts`, `GET /charts/:id` |
| `news`                    | `GET /news/feeds`, `GET /news` |
| `playlists`               | `GET /playlists`, `GET /playlists/:pluginId/:playlistId/tracks` |
| `playout`                 | `GET /playout/status`, `POST /playout/playlist`, `/playout/chart`, `/playout/skip`, `/playout/start`, `/playout/stop` (stand the station down: out of service, not merely paused). `GET /playout/audio/:sourceId` is how the player fetches every record — one URL on this machine whether or not the bytes are here yet — and is gated by a URL signed with the bridge secret. Internal and secret-gated by the `/playout/bridge/` prefix, never in the SDK: `POST /playout/bridge/aired` (Liquidsoap's air confirmation) and `POST /playout/bridge/starve`. There is no listener hook — the audience is read from the event feed and the stats poll instead; see the audience gate in `stream/README.md` |
| `nowplaying`              | `GET /nowplaying`, deliberately public and transaction-exempt: it answers out of memory and says only what a listener can already hear, plus how many of them there are |
| `director`                | `GET`/`POST`/`PATCH /director/air` (`POST` builds a broadcast from a playlist read at that moment; `PATCH` sets what puts the station on air, `audience` or `always`), `GET /director/air/order`, `PUT /director/air/persona`, `POST /director/air/extend`, `/replan`, `/shuffle`, `/segments`, `/tracks`, `PATCH`/`DELETE /director/air/hold`, and `PATCH`/`DELETE /director/air/items/:itemId` |
| `clock`                   | `GET`/`POST /clock/bands`, `PUT`/`DELETE /clock/bands/:id` — the format clock, including the bands switched off, in the operator's own order |
| `render`                  | Segments: `GET`/`POST /segments`, `POST /segments/upload`, `/segments/scan`, `DELETE /segments/:id`. Scripts: `GET /scripts`, `/scripts/summary`, `PUT /scripts/:id/rating`. Voices: `GET /voices`, `/voices/sample`, `/voices/:voiceId/sample`, `POST /voices/preview`. CRUD over `/pronunciations` plus `PUT /pronunciations/:id/state`. The pad rack: `GET`/`POST /pads`, `POST /pads/scan`, `/pads/fetch`, `DELETE /pads/:id`, `PUT /pads/:id/state`, and sets at `POST /pads/sets`, `PUT`/`DELETE /pads/sets/:id`, `PUT /pads/sets/:id/pads`. Three anonymous audio reads by necessity, for a player that cannot present a token: `GET /segments/:id/audio`, `GET /audio/:checksum/:ext` and `GET /pads/:id/audio` |
| `personas`                | CRUD over `/personas` and `/personas/:id`, plus `PUT /personas/:id/active` (puts one on air and takes the previous one off). Notebooks and stories: CRUD under `/personas/:id/notes` and `/personas/:id/stories` (with `/details`), each with a `PUT .../state` that accepts a proposal, turns one down or rests it. Authoring and transfer: `POST /personas/generate`, `/personas/restore`, `/personas/import/preview`, `/personas/import`, `/personas/:id/rehearse`, and `GET /personas/export`, `/personas/:id/export` |
| `personas.auditions`      | `GET`/`POST /personas/:id/auditions`, `GET /personas/:id/auditions/:auditionId`, `POST /personas/:id/auditions/:auditionId/cancel` |
| `schedule`                | `GET`/`POST /schedule`, `GET /schedule/current`, `/schedule/timetable`, `PUT`/`DELETE /schedule/:id` |
| `productions`             | `GET`/`POST /productions`, `POST /productions/:id/cancel` |
| `plugins`                 | `GET /plugins`, `/plugins/:id`, `/plugins/grants`, `POST /plugins/rescan`, `/plugins/:id/enable`, `/plugins/:id/disable`, `/plugins/:id/reload`, `/plugins/:id/test`, `/plugins/:id/config/suggestions`, `PUT /plugins/:id/config`, `PUT /plugins/:id/grants`; logs at `GET /plugins/:id/logs`, `/plugins/:id/logs/download`, `PUT /plugins/:id/logs/level`; OAuth at `GET /plugins/:id/oauth/authorize`, `GET /plugins/:id/oauth/callback` (necessarily anonymous — the provider redirects a browser here with no session of ours, so `state` is the only check), `DELETE /plugins/:id/oauth` |
| `topics`                  | `GET`/`POST /topics`, `GET /topics/kinds`, `PUT`/`DELETE /topics/:id` |
| `station`                 | `GET /station/attention` (everything wrong or waiting, worst first, each with the console page that can act on it), `GET /station/checkup` |
| `traces`                  | `GET /traces`, `GET /traces/:id` |
| `logs`                    | `GET /logs`, `GET /logs/:id`, `GET /logs/:id/download` — `platform.manage` rather than `platform.view`: at `LOG_LEVEL=4` the harbor logs every header of every control call, so the bridge secret can be in `liquidsoap.log` in plain text |
| `stream`                  | `GET /hls/:name` — anonymous, and the playlist GET is also the per-client heartbeat that makes an HLS listener countable; only the playlists, never the segments, which nginx serves off the volume. Plus the track fetcher's own authorization: `GET`/`POST /stream/authorization`, `POST /stream/authorization/complete` |
| `settings`                | `GET /settings`, `PUT /settings` |
| `storage`                 | `GET /storage` — what is on disk, per store, against what the database says should be there |
| `onboarding`              | `GET /onboarding`, `POST /onboarding` — anonymous, since the first-run caller has no account yet |

Every router registered in [routes.setup.ts](src/routes/routes.setup.ts) is above, in registration
order. That file stays the source of truth; `health` is deliberately first in it, answering out of
memory under both spellings (both are transaction-exempt for that reason).

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
