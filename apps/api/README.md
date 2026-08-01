# @app/api

The deadair API: a Koa server (via `@maroonedsoftware/koa` "ServerKit") that is also the radio
station itself. It serves the console's JSON API and the SPA, and in the same process it runs the
background actors that keep a stream on air: the director that decides what airs next, the render
pipeline that generates and voices DJ segments, the rundown that hands items to Liquidsoap, and the
now-playing reactor that publishes stream metadata.

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
  server/           builder wiring, middleware, cookies, dev proxies
  routes/           routers (mostly ContractKit-generated) bound in routes.setup.ts
  modules/          the app, one directory per module (below)
  shared/           path helpers, config assertions, repository types
data/
  contracts/        .ck contract definitions; `pnpm build:contracts` generates routers/types
  migrations/       dbmate SQL migrations (schema `deadair`)
scripts/            provisioning + smoke scripts (render, rundown, station, musicgraph, …)
tests/              vitest suites, mirroring src/modules
```

Import aliases (from `package.json#imports`): `#src/*`, `#routes/*`, `#modules/*`, `#shared/*`.

### Boot sequence

`setupServer()` ([src/server/setup.server.ts](src/server/setup.server.ts)) builds `AppConfig` from
dotenv **plus** the DB settings source, constructs the monitoring bus (before DI exists, so boot
logs already reach it), runs `serverBuilder.setup(config, logger, modules)`, mounts middleware and
routers, then starts listening. Modules that do I/O the first request doesn't depend on (job runner,
playout pusher, stream config materialization, health probes, show seeding) do it in `ready()`,
after the socket is up.

### DI scoping convention

- **Scoped** (per request) when the class reads the request's `AuthorizationContext` or the
  per-request DB connection: auth services, `MusicService`, `SetupService`, repositories under
  identity/authentication.
- **Singleton** when there is exactly one of the thing for the process: the station has one rundown,
  one director, one LLM gate, one rate guard per external API.
- Singletons that need a scoped-but-context-free service (e.g. the director needing `MusicCatalog`)
  hold one long-lived scope for the module's lifetime rather than faking a request.

---

## Modules

### Infrastructure / chassis

| Module | Path | What it does |
| --- | --- | --- |
| **Data** | [modules/data](src/modules/data) | The Kysely/Postgres pools. The runtime pool connects as the non-owner `app_user` role (so RLS actually enforces) with tuned pool limits and an acquire timeout; a separate owner pool handles privileged maintenance. Also the generated DB types and the shared `DataRepository` base. |
| **Shared** | [modules/shared](src/modules/shared) | `EncryptionService` (AES-GCM envelope encryption keyed from `ENCRYPTION_SERVICE_KEY`), `BootState` (the flag `/health` reads once `ready` finishes), and the request-scoped `ResponseCookieJar` used by server-rendered auth flows. |
| **Messaging** | [modules/messaging](src/modules/messaging) | No-op outbound email/SMS: messages are logged, not sent. The auth flows call this interface, so swapping in SMTP/SES/Twilio is a body change here and nothing else. |
| **Events** | [modules/events](src/modules/events) | The in-process `EventBus` plus an empty subscriber registry that contributor modules populate in their own `start()`, which is what breaks the events↔identity import cycle. |
| **Monitor** | [modules/monitor](src/modules/monitor) | Registers the process-wide realtime `ServerFeed` (built in `setup.server.ts` so the app logger can bridge into it). Every producer, including render, jobs, the director and health probes, publishes progress/status/errors here; the console consumes it over the `/monitor/stream` SSE route. |
| **Config** | [modules/config](src/modules/config) | Exposes the live `AppConfigStore` so modules that must *react* to a config change can subscribe. Also `app.config.source.db.ts`: an `AppConfigSource` over the `deadair.settings` table, layered over dotenv, holding the single `LISTEN deadair_settings_changed` that makes a console save reload config with no restart. `settings.keymap.ts` maps setting keys to `UPPER_SNAKE` config keys. |
| **Settings** | [modules/settings](src/modules/settings) | The `deadair.settings` repository itself (read/write, with encrypted values where needed). |

### Identity and access

| Module | Path | What it does |
| --- | --- | --- |
| **Authentication** | [modules/authentication](src/modules/authentication) | Wires `@maroonedsoftware/authentication`: scheme handlers (bearer JWT, basic), the app's JWT and basic issuers, factor services and repositories (password, email, phone, OIDC, FIDO, authenticator), OTP (with a development-only bypass that hard-fails outside `NODE_ENV=development`), Redis-backed rate limiting, sessions and login-activity services. |
| **Identity** | [modules/identity](src/modules/identity) | Deliberately minimal: the only identity aggregate is the **actor** (a login plus its factors). The `types/` here are the chassis' broader identity vocabulary, unused by deadair. |
| **Authorization** | [modules/authorization](src/modules/authorization) | The per-request `AuthorizationContext` (actor identity plus IP/user-agent for the audit log). A default anonymous instance is registered so routes that never hit the middleware (setup) still resolve. |
| **Policies** | [modules/policies](src/modules/policies) | The concrete `PolicyService` and the bundled authentication policies. MFA is currently disabled by overriding the `mfa.required` / `mfa.satisfied` bindings with always-allow policies. |
| **Setup** | [modules/setup](src/modules/setup) | First-run wizard backend: records connection details and provisions the genesis admin actor with an email + password factor. Database creation/migration is out of band via dbmate. |

### Station domain

| Module | Path | What it does |
| --- | --- | --- |
| **Station** | [modules/station](src/modules/station) | The station's memory: an append-only event log plus the snapshot a reducer folds it into. Anything that writes a script reads the snapshot instead of live playback state. `ready()` replays the tail of the log so a restart resumes its shift rather than starting cold. |
| **Music** | [modules/music](src/modules/music) | Music-provider integration. Spotify: operator app credentials in settings, per-actor OAuth tokens envelope-encrypted in `deadair.provider_accounts`, a rate guard and a process-wide refresh coordinator that single-flights token refreshes. Navidrome: a Subsonic client and catalog, station-level and inert unless configured. `MusicCatalog` is the provider-agnostic seam consumers depend on. |
| **Playout** | [modules/playout](src/modules/playout) | The station's own **Rundown** (the ordered list of what airs next, where an item is a track *or* a rendered DJ segment), the `TrackResolver` seam that turns an item into a fetchable URL (pre-signed Subsonic, signed Spotify shim), and `PlayoutPusher`, which drains the rundown into Liquidsoap's `request.queue`. The pusher reconciles against a fresh reading of the player on every pass, so a Liquidsoap restart is a non-event. Careful distinction throughout: an item handed over is *served*, not *airing*, until the player confirms it. |
| **Director** | [modules/director](src/modules/director) | The rotation clock. A singleton reactor that keeps the rundown filled ahead of the player's pulls and commissions music-aware talk breaks on a cadence, either placed between two tracks or (with talk-over on) streamed to the harbor to duck over the bed. `director.clock.ts` is the pure, exhaustively testable decision core; `playlist.ts` is the ordered plan of intent (with breaks as first-class planned items) and its cursor, corrected from what actually aired. Also owns play history. |
| **Enrichment** | [modules/enrichment](src/modules/enrichment) | External metadata (MusicBrainz + Cover Art Archive, Last.fm, Discogs) merged and cached in the DB, plus `MusicGraphService`, the similarity graph the DJ's pool builder expands from. Strictly best-effort: never throws, so the rotation clock is never at risk. Per-source rate guards are singletons; a coordinator single-flights concurrent lookups. |
| **NowPlaying** | [modules/nowplaying](src/modules/nowplaying) | The always-on reaction to what is on air, running headless regardless of any open console. On a genuine track change it persists the authoritative snapshot (served by the public `GET /now-playing`), pushes metadata to every sink (Icecast, TuneIn AIR), and fires the DJ track-change hook. It also follows the DJ voice, so while a segment airs the sinks carry a station line instead of a song that isn't playing. Driven entirely by local events: zero Spotify Web API calls. |

### Generation and output

| Module | Path | What it does |
| --- | --- | --- |
| **Engine** | [modules/engine](src/modules/engine) | Console-editable generation configuration. Operators register any number of LLM and TTS providers and assign a provider+model per *usage* (talk break, show, …); the resolvers here map usage → decrypted provider config. Includes voice profiles and cached voice previews. |
| **Render** | [modules/render](src/modules/render) | The content pipeline: shows (recurring programs) → rendered episodes. Repositories for shows, episodes, transcripts, generation progress and resumable-generation checkpoints; `tts.renderer.ts` (OpenAI-compatible HTTP backend targeting Kokoro or cloud, with a macOS `say` fallback); `ffmpeg.ts`; `llm.gate.ts`, the process-wide LLM serializer that lets on-air work jump ahead of background renders; `GenerationControl` for hard-cancelling a running render; and `harbor.pusher.ts`, the on-air voice transport that streams each rendered segment to Liquidsoap's `input.harbor` mount (serialized, since a harbor mount accepts one source at a time). `ready()` seeds the default shows and starts a reconciler that fails episodes a killed process abandoned mid-render. |
| **Search** | [modules/search](src/modules/search) | Web-search grounding (SearXNG by default, Tavily/Brave optional), mapped into the `NewsItem` shape the generators already narrate. Best-effort: resolves to `[]` when nothing is configured, so a `search` show degrades instead of failing. |
| **Jobs** | [modules/jobs](src/modules/jobs) | Background work on pg-boss via `@maroonedsoftware/jobbroker`, run in-process in its own container with retry and dead-letter policy. Jobs: generate an episode (including draft generation, approved-draft rendering and answering a gate a parked run is waiting at), generate a music break, air the current daypart's cached station sign-on, and refresh the sign-on cache. Installs the recurring generation schedule from live config and re-registers it when an operator changes it, plus a daily sign-on rebuild. |
| **Stream** | [modules/stream](src/modules/stream) | Materializes `radio.env` for the Icecast/Liquidsoap containers from DB settings (they can't read Postgres), re-rendering on every settings change via the config store. Carries the playout bridge wiring and the duck settings (`talkOverTracks`, `duckGainDb`, `duckFadeMs`). Also probes Icecast status and listener counts. Best-effort: skips quietly when the stream isn't configured or the config dir isn't writable. |
| **Health** | [modules/health](src/modules/health) | A periodic (default 30s, `HEALTH_PROBE_MS`) reachability probe of Ollama and Kokoro feeding the console's health tiles. Starts in `ready()`, unref'd timer, stops the moment shutdown begins. |

---

## Routes

Routers are registered in [routes.setup.ts](src/routes/routes.setup.ts). Most are generated by
ContractKit from the `.ck` contracts under [data/contracts](data/contracts) (`pnpm build:contracts`);
a few are hand-written for browser-facing flows that aren't JSON APIs.

| Router | Surface |
| --- | --- |
| `healthcheck` | liveness/readiness (reads `BootState`) |
| `setup` | first-run wizard |
| `authentication`, `.web`, `.sessions`, `.factor` | login/registration API, server-rendered web flows, session management, factor management |
| `stream` | stream settings and status |
| `render`, `render.audio` | shows/episodes console API; hand-written `GET /render/episodes/:slot/audio` streaming the rendered MP3 (binary, so outside the JSON-only codegen) |
| `engine`, `engine.voices` | LLM/TTS provider config; voice list, previews and binary upload |
| `music`, `music.internal` | console music API; a secret-gated route handing the Spotify track shim its login |
| `spotify.oauth` | hand-written OAuth callback (stays anonymous) |
| `playout.internal` | the Liquidsoap-facing playout bridge, gated on `PLAYOUT_BRIDGE_SECRET` in an `X-Playout-Secret` header (404 when the secret isn't seeded) |
| `nowplaying.public` | public, unauthenticated `GET /now-playing` off the reactor's in-memory snapshot, with cover art proxied rather than linked (a Navidrome artwork URL carries credentials) |
| `monitor` | polling fallback over the same in-memory bus, sharing the SSE route's filter grammar. `/monitor/stream` itself is added in `setup.server.ts`, since it needs the builder's lifecycle signal |

### Server middleware

[src/server/middleware](src/server/middleware) holds the audit and authorization context middleware,
refresh-cookie handling, the SPA fallback, and the proxies: the Icecast stream proxy, and in
development a proxy to the Vite dev server (with a matching WebSocket HMR proxy attached to the
HTTP server).

---

## Common commands

```bash
pnpm --filter @app/api dev
```

```bash
pnpm --filter @app/api test
```

```bash
pnpm --filter @app/api migrate:up
```

`build:contracts` regenerates routers/types from `data/contracts`; `build:datatypes` runs the enum
override sync then `kysely-codegen`; `rebuild:data` rolls the schema all the way down and back up.
