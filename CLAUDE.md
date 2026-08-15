# deadair

An AI radio station. Today the repo is a Koa API (`apps/api`), a React console (`apps/web`), a
plugin system for music providers and enrichment sources (`packages/plugin-sdk`, `plugins/*`), and
the identity/permissions/settings chassis underneath them. The station actors themselves (director,
render pipeline, rundown, now-playing reactor) are the goal, not the current tree: **no decoding,
mixing or encoding happens in Node**, and Liquidsoap and Icecast run in sibling containers. That is
the true version of "audio never touches Node", which this file used to state as an absolute the
code visibly contradicted: `speak()` returns a real `ReadableStream`, the render pipeline writes
segment audio through Node, and Liquidsoap fetches it back over HTTP.

## Workspace

```
apps/api          Koa server, ContractKit routers, dbmate migrations
apps/web          React console (Vite, TanStack Router)
packages/plugin-sdk   the plugin contract and host capabilities
packages/sdk          typed client for the API
packages/error-codes  shared error code constants
packages/config-*     shared eslint / tsconfig
plugins/*             bundled plugins: spotify, navidrome, musicbrainz, kokoro (the station's
                      voice), llm, analyzer (the adapter over the measurement sidecar)
analysis/             the measurement sidecar: a Python service that decodes a record and answers
                      with its cue points and its loudness. No decoding happens in Node
stream/, nginx/, docker-compose*.yml   Icecast, Liquidsoap and friends
```

Current `apps/api` modules: `data`, `crypto`, `authentication`, `permissions`, `policy`, `jobs`,
`art`, `catalog`, `onboarding`, `settings`, `stream`, `plugins`, `playlists`, `llm`, `personas`,
`render`, `playout`, `nowplaying`, `analysis`, `director`, `enrichment`, plus process-level `logging`.
`src/modules/modules.ts` is the source of truth, in that order; check it before assuming a subsystem
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
- `docs/decisions/analysis-licensing.md` for the rule that every dependency in the analysis path is
  permissive (MIT/BSD/ISC/Apache), weights included, and for the fact that the `analysis/` sidecar is
  NOT a licence workaround: it exists because decoding does not happen in Node, and folding it back
  into the app would cost that and nothing licence-shaped. Read it before pinning anything in
  `analysis/requirements.txt`, and note that the licence to check is the model WEIGHTS' licence,
  which is not in the package metadata.
- `docs/decisions/on-air-ownership.md` (stage 1 built; stage 2 built except its rundown merge) for
  why the director is the sole writer of the running order, and the four bugs that were all the same
  bug. Read it before touching `director/`, `Rundown`, or anything that writes
  `deadair.station_lineup` or `station_air`. Three things in it are load-bearing for anything new:
  **every writer posts a command and none of them writes the running order itself**; **a mailbox
  cannot cancel**, so anything that must stop work in flight bumps the epoch synchronously and posts
  only the durable half; and **nothing runs a commit pass off the queue**, including the first one at
  boot.
- `docs/decisions/bytes-before-air.md` for why a record is not committed until its audio is local,
  why the gate cuts rather than filters, why a cold record is held where a cold segment is skipped,
  and why it fails open. Read it before touching the commit pass, `TrackCachePlanner`, or the
  relationship between `CACHE_AHEAD` and `COMMIT_LEAD`.
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

**`host.fetch` policy is per upstream, and its budget is the live one.** `permissions.network` entries are bare hostnames, or objects carrying `ratePerSecond` and a shared `bucket` (a published limit usually covers a service, not a hostname), or `{ fromConfig: 'baseUrl' }` for an address the operator supplies. The fetch budget is capped by whatever the _current invocation_ has left, published by `PluginInvoker` through `plugin.invocation.deadline.ts` and readable by plugins as `host.remainingMs()` (sync) or watched as `host.signal`, not by the `PLUGIN_INVOKE_TIMEOUT_MS` constant. `host.signal` is the invoker's own `AbortController` signal rather than a copy, so honouring it and being abandoned are the same moment. Everything the host throws at plugin code is a `PluginError`, never a `ServerkitError`: the invoker's `toPluginError` flattens anything else to `internal`, and the status the host chose never reaches the client.

**A plugin extends `Plugin` and registers its own teardown.** `packages/plugin-sdk/src/plugin.base.ts`: `this.host` is a getter that throws a sentence naming the plugin rather than a `TypeError`, and `register(disposer)` puts an undo beside its setup, run last-registered-first on unload even when one throws. This matters more in-process, not less, because a timer a plugin forgets lives in the API server until a restart and an operator reloads plugins on every config change. Extending it is optional; the host only ever asks for `PluginLifecycle`. Note `host` being a getter costs TypeScript's narrowing of other properties across a read of it.

**The station's words are a plugin, and the loop around them is not.** `llm` capability,
`plugins/llm` on the AI SDK's OpenAI-compatible provider so one plugin covers a local server and a
hosted one alike. `llm.pluginId` picks it, mirroring `render.speechPluginId` including its refusal to
guess. The MODEL is a per-call parameter rather than config, because `plugin_configs.plugin_id` is a
primary key and a station wanting a big model for a show and a small one for an ident cannot express
that by installing twice. Three things stay host-side in `modules/llm/`, deliberately: `LlmGate`,
which holds one model slot **until the words stop arriving rather than until the call resolves**, with
its budget starting at admission and covering the drain; the tool loop, because a tool is a station
function and running one inside a plugin would be the wrong side of the fence; and `ToolRegistry`,
whose sources are an explicit list (catalog search today). A tool declaration goes out and a tool
call comes back, both plain JSON, so nothing executable crosses. **A station with no model plugin is
an ordinary state, not a fault** — `canGenerate()` answers it without throwing, so a writer picks its
deterministic binding.

**A kind of break has SEVERAL writers, and the last one is its floor.** `BreakWriterRegistry` is
keyed by `segments.kind` and holds them in registration order, which IS preference order
(`director.module.ts`): `ModelTalkBreakWriter` in front, `TalkBreakWriter` behind it. A writer that
declines, answers with whitespace or throws is the same outcome — ask the next — so the fall-through
lives there rather than inside any one writer, and `llm.breakWriter` being off is just the first one
declining early. **The floor cannot fail**, which is what makes a slow model cost a better sentence
rather than a silent station. The registry answers with every ATTEMPT rather than only the winner,
because a model that declined and a floor that covered for it are two facts and the second alone
reads as a station that never had a model.

**What the station PLAYS has several generators too, and that chain tops up rather than falling through.** `SetGeneratorChain` is registration order as preference order, exactly like the writer registry (`ModelSetGenerator` in front, `CatalogSetGenerator` behind it, `llm.setGenerator` off by default). The one difference is load-bearing: a break is one sentence and is all-or-nothing, so the writer registry takes the first answer and stops, but a set is `count` picks and a model that named six of fifteen has done most of the job. So each binding is asked for what is still MISSING and the floor finishes the rest, which is why a partial answer is kept rather than discarded. Songs already chosen thread down as `avoidSongKeys`; artists deliberately do NOT, because excluding every artist already queued starves a long rotation of its own library — an artist is spaced within a batch and cooled down once they actually air, which are the two places it can be judged against something real. **The floor cannot fail**, so keep it last.

**An opinion is held at three levels and inherits DOWNWARD in both directions.** `artists`, `albums` and `tracks` each carry a `rating` of `-1 / 0 / 1`, written from the console through `PUT /catalog/{artists,albums,tracks}/{id}/rating` (`platform.manage`; the wire spells it `liked / neutral / disliked` and `catalog/rating.ts` is the only place that meets the column, because the ORDERING is what the SQL below needs and nothing outside the database reads it as a number). `CandidatesRepository.effectiveRating` is the one expression that collapses the three into one, and it is **not** a `least()`: a dislike anywhere wins outright, because a dislike is an instruction no lineup may turn off, and otherwise the strongest LIKE carries, because liking an artist means play more of them and liking one song means play that song more. It was a plain `least()` for as long as it existed, which got the veto right and silently swallowed the other half — a liked song on an unrated record by an unrated artist came out `0`, so `weightOf` doubled nothing an operator could produce without rating all three levels identically, and liking a record did nothing whatsoever. Both `sample` and `ratingsFor` go through it so the draw and the resolver cannot disagree. Nothing unit-tests it, since it is SQL: `apps/api/scripts/rating.smoke.ts` is what covers it, against the real database.

**A pick is judged where it becomes a track, never inside the generator that named it.** A `SetGenerator` pick is a NAME, so any binding that is not the catalog draw hands over titles nothing has judged — and a dislike is an INSTRUCTION no lineup may turn off, so a generator able to route around it airs a record the operator forbade. The rules therefore run in `PickResolver.resolve(picks, rules)`, the one step every pick from every source passes through. `CatalogSetGenerator` still filters before its own draw and that is NOT redundancy: filtering early keeps the draw from spending its weight on candidates that cannot air, filtering at the resolver makes the rules true for a generator that never read the catalog, and neither is safe to delete because the other exists. `applyRules` composes the three that decide whether a candidate may air; `spaceArtists` runs last and separately, because a batch spaced before its unplayable tracks are dropped closes the gap back up and puts one artist back on its own heels.

**A pick the catalog has never seen is looked up at a provider and INGESTED, and the order of that against the rules is load-bearing.** The library holds what the account's playlists carry, because playlists are the only enumeration a provider offers, so a perfectly good pick outside them used to be dropped. `PickResolver.identify` now falls to `ProviderTrackLookup`, and a hit becomes a real `deadair.tracks` row with a binding — it has to, because the player fetches every record through `track_sources`, so a copy with no binding has no URL. The lookup is STRICT (normalized title and lead artist must both match exactly; duration only breaks a tie), because a near-miss does not error, it airs the wrong record while the console says otherwise. It is bounded per resolve (`MAX_DISCOVERIES`, counted as attempts) since every miss searches every provider, and gated by `rotation.discover`, on by default because off makes the path inert. **Ingest happens BEFORE the rules run**, which is what makes a newly ingested record by a disliked artist get dropped rather than aired for want of an opinion. The other half is `track_sources.origin`: the sync's `markMissingTrackSources` only judges `origin = 'sync'`, because the sweep is an argument about what a playlist WALK saw and a discovered copy is in no playlist — without it the first sync after a discovery benched everything the station found for itself. A walk that later sees a discovered copy moves it into the sweep; a lookup never moves a synced one out. What judges a discovered copy instead is fetching it, via the four-failure bench in `TrackAudioService`.

**Two search tools, and the split is now HAS versus CAN GET.** `LibrarySearchTool` (`search_library`) answers from `deadair.tracks` — catalogued, bound, already on hand — and `CatalogSearchTool` (`search_catalog`) fans out over provider plugins and reaches everything they offer. Choosing wrongly used to be silent and fatal: a `search_catalog` pick matched no catalog row and was dropped, so the running order came up short with nothing connecting it to the search. **That is no longer true** — `PickResolver` looks a missing record up and ingests it — so both tools answer with records that can air, and what is left is a PREFERENCE the descriptions carry: the library first because those records are owned, measured and free to play, the providers second because that is the only way to programme against a brief the library cannot fill. A third tool, `StationTasteTool` (`station_taste`), answers what the operator has liked and disliked; it reports and never enforces, and `ModelSetGenerator` also puts a short version straight in its prompt so a model that cannot drive tools still gets the steer. On the library tool, **bans narrow it and rotation rules deliberately do not**: a disliked record is excluded because a dislike is absolute, while a record inside the repeat window is still offered, because variety is enforced at the point of choice and pre-filtering returns a worse pool on a small library.

**Both search tools answer with the LEAD artist, never a credit line, and that is a correctness rule rather than a formatting one.** The model is told to copy a title and artist back exactly, because `ProviderTrackLookup` is strict — and the two steps that then judge the pick both match on the lead artist alone: `PickResolver.identify` keys it `songKey(title, [artist])` and the lookup compares `normalizeKey(track.artists[0])`. `CatalogSearchTool` answered `artists.join(', ')` for as long as it existed, so every collaboration it returned was named correctly by the model and then dropped as "not in the catalog" — a live run resolved every solo credit and lost every duet. The other credits ride in `featuring`, which is shown and never copied. Anything new that hands a model a record to name owes the same shape. The related bound is that these tools must offer enough rows to fill an OVERSAMPLED batch (`MAX_RESULTS` is 25 on both): a model shown ten records and asked for two dozen pads the answer with repeats, `SetGeneratorChain` discards them, and `CatalogSetGenerator` — which cannot act on a brief — quietly fills half the hour.

**One model slot, and it stays one.** `LlmGate` serializes because there is one process with one set of weights on one GPU. Two callers now want it at once — a refill holds it for minutes, a break wants it for seconds — and that is still not an argument for a pool: a second app-side slot relocates the queue to the model host, where there is no `maxWaitMs`, and that timeout is the entire mechanism by which a break writer gives up and lets the floor write. Widening the gate would remove the thing that keeps a slow model from costing a silent station while looking like it was helping. The asymmetry is PRIORITY, not throughput, and it is expressed by bounding the background job (`ModelSetGenerator.BUDGET_MS`), which needs nothing from the gate. **A model budget and degradation tiers are deliberately NOT built** (`docs/todo/station-intelligence.md` §2, deferred against its own ordering claim): every call goes through `LlmService`, so the retrofit is one file, the model is self-hosted so nothing is billed, and "no tier makes music stop" is already structural — the chain tops up and the writer registry falls through.

**The station's phrasings are the operator's.** `rotation.breakTemplates`, one per line, with the
station's own five as the DEFAULT — so clearing the box restores them rather than producing a silent
DJ, and the way to stop it talking stays `rotation.breaks`. `{{next.title}}` resolves through an
explicit map in `break.templates.ts` (which is why `{{next.album}}` is one row to add when enrichment
lands), `[[double brackets]]` mark a part dropped when it cannot be filled, and a template with an
unknown placeholder is never used and is logged once, quoted. Two rules are the writer's rather than
the operator's: a placeholder outside an optional chunk that cannot be filled means the phrasing does
not apply, and a phrasing saying nothing about the record just finished is only offered where there
is none.

**Who the station IS is a row, and it reaches four things rather than one.** `deadair.personas`, one
active per station enforced by a partial unique index, with its own contract and its own console page
— a table for the reason `docs/todo/station-moment.md` argues moods are one: a `ConfigField`
describes one row of a form and this is a list an operator adds to and switches between. It replaced
`llm.breakPersona` and `llm.setPersona`, both retired, and the reason it could not stay two settings
is what putting one on air now does: it changes what the model is TOLD (the sheet, in
`break.prompt.ts`), what the station says when the model declined (the persona's own `templates`,
ahead of `rotation.breakTemplates` in `resolveTemplates`), which VOICE speaks it (`segments.voice`,
stamped by `WriteBreakJob` in the same statement as the words), and what it PROGRAMMES towards (the
`music` line, and only that line — what a character sounds like has nothing to do with what it
plays). Five things are load-bearing. **`diction` is not a quirk**: a quirk applies to the sentences
it fits and diction applies to every sentence there will ever be, which is why it leads the sheet AND
is restated after the content rules — the failure it addresses is CAUSED by those rules, since a host
reads seven careful instructions about naming records accurately and answers them in careful, plain
English. **A persona REPLACES the role sentence** rather than queueing behind it, because a model
told both that it is the voice of a radio station and that it is a pirate captain hedges. **The
templates chain rather than merge**, since mixing the pools would put plain English back in at
random, which is the whole failure. **`dictionMarkers` make character checkable** — `readAnswer`
declines a script carrying fewer than two, and declines rather than re-drafting, because the floor
underneath now speaks in the same character and a break writer's one job is not to be slow. And **a
sheet that named no markers passes everything**, because an author who filled in fewer boxes made no
checkable claim and should not have their scripts refused for it. The four seeds are written from
`persona.defaults.ts` in `ready()` rather than from the migration, so the sheets have one source, and
the guard is that the station is EMPTY rather than that each key is missing — which is what makes
deleting a seeded persona expressible. None of them names a voice: which ids exist is a question only
the installed engine can answer.

**A break's forward claim is checked before it airs.** "Coming up, X" is a statement about the future
baked into audio that cannot be re-cut, so `segments.claims_item_id` records the lineup LINE the
words named, and `toPlayerItems` drops the break when that is no longer what plays next. The next
record is offered to a writer only when it is the adjacent line, since a promise made across an
intervening segment is the least trustworthy kind. Silence on one boundary beats a wrong fact.

**Everything the station writes is kept.** `deadair.script_history`, one row per write ATTEMPT,
append-only and with no `updated_at` — a correction is another attempt, which is another row. It
outlives its segment (`on delete set null`, denormalised), holds the writer, the model, the template,
the neighbours, the token counts and the duration, and is swept nightly against
`render.scriptHistoryDays`. The prompt and the raw answer are kept only while `llm.captureWrites` is
on, which is a switch for an evening of prompt tuning rather than a default.

**The station's voice is a plugin.** `speech` capability, `plugins/kokoro` first, Chatterbox expected. A voice is an opaque station-level id (`host`, `newsreader`) that the PLUGIN maps in its own config; the host never interprets it, and engine-specific knobs stay with the engine. `render.speechPluginId` picks the speaker when several can talk, and declines to guess when none is chosen. **A segment carries a state per STAGE** — `planned → writing → written → rendering → ready`, with `failed` off the side — because making a break is two jobs with different failure modes: `WriteBreakJob` decides the words and `RenderSegmentJob` produces the audio, each claiming the row with a conditional update so a duplicate send is free. `claimForRender` starts at `written`, which is what makes a retry after a failed render re-speak the words already on the row instead of paying a writer to invent different ones. Throughout, **a segment that is not `ready` is skipped, never waited for**, which is what keeps a broken renderer from ever costing the station silence.

**A break is written when its slot comes near, not when it is planted.** Planting stays eager and runs to the end of the order, because the position is what keeps the spacing stable; `BreakPlanner.ripen` asks for the WORDS only within `WRITE_AHEAD` items of the cursor. That is the difference between an hour of forward planning and an hour of model and speech work an operator edit can throw away. Sending is free because the job claims the row first, so the director re-offers whatever is still `planned` on every boundary and a lost job heals itself — and an off-air station writes nothing at all. Note the ordering trap it was built around: the running order is written through a THROTTLE, so a job can pick up a break the persisted row does not hold yet; the neighbours are therefore read before the claim, and absent-from-the-order means early rather than has-no-neighbours.

**In plugin code, `undefined` means "not set". Never `null`.**

**Module lifecycle order is load-bearing, and SHUTDOWN runs in the same order rather than in reverse.** The list in `apps/api/src/modules/modules.ts` is ordered deliberately and the comments there explain each placement. `PluginsModule` sits after everything its host reaches into, `PlaylistsModule` after `PluginsModule`, and `LoggingModule` stays last so every other module's shutdown logging is flushed before the log store closes. Work the first request does not depend on belongs in `ready()`, after the socket is up, not in `start()`. Because ServerKit walks ONE list both ways, a dependency order read forwards is a teardown order read backwards, and two rules fall out of that. **Nothing others depend on may close in its own position**: `DataModule` registers first and must, so closing the pools is a separate `DataConnectionsModule` at the END — with the close still up front, every module below tore down against a destroyed driver and the director's flush of the running order, which is a guarantee rather than a nicety, was lost on nine of the shutdowns in one log. And **no hook may cost the ones after it their teardown, or the process its exit**: ServerKit's shutdown loop catches nothing and bounds nothing, unlike the `ready` loop above it, so `withBoundedShutdown` wraps every hook at the list. A hook that hung left fourteen processes in that log still running their loops after being told to stop, one of them probing Liquidsoap for hours on a rotated secret.

**Logging is process-level and predates DI.** `RotatingLogStore` is constructed in
`setup.server.ts` before any container exists, published through `setLogStore`, and wrapped by
`FileTeeLogger` so every module's lines land on stdout and in `logs/`. `PluginLog` tees plugin
output to the app logger plus a per-plugin rotating file with its own verbosity gate. Malformed
`LOG_MAX_*` values fail loudly at boot by design.

**`deadair.settings` is a layer of `AppConfig`, so reading a setting needs no scope.** `setup.server.ts`
builds a boot snapshot (dotenv only, for the log store and the database credentials), then an
`AppConfigStore` over that same dotenv layer plus `AppConfigSourcePostgres` pointed at
`deadair.settings`, and hands the container `store.toLiveConfig()` — a live view whose every read
resolves against the current snapshot. So `config.get('playout.airMode')` works from a singleton
with no DI scope, which is what `AudienceWatch` and the playout transport are. Keys stay flat and
dotted; nothing collides with dotenv's SCREAMING_SNAKE. `scrubProcessEnv()` runs after both builds,
which is why the settings source is handed **resolved literal** credentials rather than `${env:…}`
templates: it would otherwise connect once and fail every reload after that, silently, because a
failed rebuild keeps the last-good config.

The store holds a `LISTEN` on `deadair_settings_changed` (migration 0003's trigger), so a row edited
by psql applies live. **A write made inside a request cannot be read back through the config in that
same request** — Postgres holds notifications until COMMIT — so `SettingsService.set`/`write` defer
`store.reload()` through `AfterCommit`, and a route that must answer with what it wrote builds that
answer from the write rather than re-reading. Writing a setting anywhere else has to do the same or
the operator's change will not take.

**Settings are declared in `settings.registry.ts`** as the plugin SDK's `ConfigField`, which is what
lets one console component render both a plugin's settings and the station's. `GET`/`PUT /settings`
are the operator surface; a `secret` is reported as a configured-boolean and never as a value. The
registry is not where a setting is READ — each module keeps its typed resolver (`resolveStreamSettings`,
`parseAirMode`, `stationRules`) and shares the registry's defaults so the two cannot disagree. A row
nobody declared is left alone rather than deleted. Still constants, deliberately: the four mixer
knobs, because the real work there is a Liquidsoap restart (`docs/todo/mixer-settings-in-db.md`).

**Nothing watches `plugin_configs`.** A plugin's configuration changes only through
`PluginsService`, and every route there that writes one reinitializes the plugin itself. There is no
`LISTEN`/`NOTIFY` path and no trigger on the table (an earlier one was removed): a row edited out of
band is applied by `POST /plugins/:id/reload`, or not at all. Anything that grows a second writer of
that table has to call `PluginLifecycleManager.reinitPlugin` itself, and has to do it through
`AfterCommit` rather than inline: the manager is a singleton reading and writing that row on its own
pooled connection, so from inside the request's transaction it reads the row as it stood BEFORE the
write and its own `setStatus` upsert then waits on the lock the request is holding, while the
request waits on it. Postgres does not call that a deadlock, because only one of the two is waiting
in the database. `reloadPlugin` is inline precisely because it writes nothing.

**One running order per station, owned by the director, and it is not a library.**
`deadair.station_lineup` holds it as one jsonb document of items, each carrying its own state
(`planned → handed → airing → played`, with `skipped` off the side). There is no cursor and no
revision: the position IS the states, so the plan and what actually aired cannot disagree. It is
built from a playlist when the station goes on air and CONSUMED — prepared material is a playlist,
and the rule that keeps the two honest is that if it is airing it is a lineup and if it is prepared
it is a playlist. Memory is the authority and the row is the record: an acknowledged edit is written
through before its caller is answered, everything the transport does rides a throttle, and a
graceful shutdown flushes. `station_air` says only whether the station is driving. Every writer
posts a command to `DirectorService`; nothing else may write it.

**A broadcast has an IDENTITY, and everything written while it runs carries it.**
`station_lineup.broadcast_id` is minted when a running order is built and kept for as long as it
airs, so `play_history`, `segment_events`, `script_history` and `station_events` can all answer "what
happened during last night's show" rather than only "what happened between these two timestamps". It
is an id and not a library: nothing looks a broadcast up and no row is a running order that is not
the live one, so the rule that a lineup is consumed rather than kept is untouched. Two consequences
are load-bearing. `putOnAir` builds a **new** `StationLineup` rather than rebinding the old one,
because reusing the object would keep the previous broadcast's identity and file the next hour under
a programme that has already ended; `rebind` therefore cannot change it, and says so. And the id is
read back by `StationLineupRepository.load`, so a restart mid-programme resumes the same broadcast
instead of starting a second one halfway through. `StationIdentity`
(`modules/shared/station.identity.ts`) is how anything outside the director reaches it — the director
is its only writer, and `undefined` means genuinely no broadcast (a library scan, a plugin reload, an
operator's setting change), which those writers must store as null rather than reaching for whichever
broadcast was last on. The same file holds `stationKey`, which is on every station-owned table from
the first migration: `play_history`'s three indexes lead with it because a repeat window and an
artist cooldown are per-station questions, and the activity feed filters inside each arm of its union
rather than over the result, so each arm keeps its own index.

**The order also carries the operator's BRIEF, and that is why it is on the row rather than in a job
payload.** `station_lineup.brief` is what they asked for in their own words ("heavy metal hits"), as
distinct from `name`, which is only a label. It rides the running order because `onEnd: 'extend'`
keeps asking for more: a theme held in a refill's payload would last one batch and drift back to
ordinary rotation within the hour with nothing saying so. It reaches the model in the USER turn (this
refill's instruction, where the system turn is the standing job), and a briefed refill is not sent
the presenting persona's `music` line AT ALL. That is structural rather than an instruction, and
deliberately so: it read "where the two disagree, follow this" until a local model handed both
"ambient and nothing else" and "heavy metal hits" was observed to split the difference, and the
cheapest way to make a brief win is not to hand over the competing text. So the rule is one rule with
no switch — **brief the station and the persona is purely the presenter; leave it unbriefed and the
persona programmes** — which is what makes a persona a DJ rather than a second opinion.
`station_lineup.persona_id` rides the row beside the brief for the same reason the brief is there,
and `PersonaRepository.presenting` is the ONE place the precedence lives (this broadcast's host, then
the station's active one, then nothing) because the break writer and the record chooser both read it
and a station whose DJ depends on which one you ask is two stations.
`CatalogSetGenerator` ignores it deliberately — approximating an instruction would make the thing
that cannot fail depend on how well a guess landed — so a briefed station whose model produced
nothing gets an ordinary hour rather than a bad impression of the one it asked for.

**Removing a break MARKS it; removing a record splices it.** `StationLineup.remove` is asymmetric on
purpose. `BreakPlanner` is idempotent positionally and by nothing else — it counts records since the
last segment already in the order — so a spliced-out break left a gap it could not tell from one
never planted into, and it planted another one a boundary later. `removed` is that mark, it resets
the walk's count like any other segment, and it ages out through `trimPast`. **It is its own state
rather than a use of `skipped`**, which would have done the planner's job and nothing else:
`skipped` is the station reaching an item and passing over it (no audio, nothing could resolve it, a
push the player never took) and `removed` is an operator cutting one before its turn, and those are
opposite facts on any page that has to say why the station is silent. Two things read the
difference: `committedThrough` counts every non-`planned` state as the head EXCEPT `removed`,
because a cut says nothing about how far the broadcast has got and counting it would freeze the
order in front of it; and `DirectorService.collectRemoved` retires the segment row behind the cut,
leaving a `ready` row alone and leaving any id still elsewhere in the order alone, since idents come
from a shared library and the same row is legitimately at three slots in an hour.

**A record is COMMITTED only once its audio is on this machine.** `DirectorService.withLocalAudio`
cuts the commit pass's candidates at the first record `TrackAudioService.readyFor` does not answer
for, so Liquidsoap's resolve is a read from this app rather than a provider download inside the
request it is waiting on — which is what produced the 2.16 seconds of digital silence in
`docs/todo/provider-audio-failures.md`. Four things are load-bearing and `docs/decisions/bytes-before-air.md`
argues each: it CUTS rather than filters, because filtering would commit the warm items and leave the
cold one behind them, reordering an operator's sequence by which downloads finished first; a cold
record is HELD rather than skipped, which is the exact opposite of the segment rule beside it (a break
is disposable and a record is not); `readyFor` demands the row's checksum AND the file, since a row
whose file was deleted is repaired by re-fetching on the air path; and it fails OPEN, because a gate
that could not read its own answer would take the station off air within three items over a transient
database fault. `order.waitingOnAudio` is on the feed for a station that has been unable to commit for
`WAITING_ON_AUDIO_MS`, written once on the edge. **With the bytes local the commitment horizon
collapsed to ONE**: `COMMIT_LEAD` and `PLAYOUT_LEAD` are both 1 and move together — the pusher can
only hand over what the director prepared, and Liquidsoap's `prefetch` is materialized from the
same constant, so raising one alone buys nothing. An operator's edit now lands on the next record
rather than three later, and the price, taken deliberately, is the SECOND skip: measured at ~200ms
onto a resolved item against >1.2s or no boundary at all onto an unresolved queue, so the first
skip still lands and one taken before the replacement resolves does not. `SEGMENT_SLACK` is what
keeps a window of one honest — a segment may produce no player item (skipped, or a talk-over that
rides the record behind it), so segments ride along for free and only RECORDS count against the
lead. `RESOLVE_GRACE_MS` is 5s on the same argument and is reasoned rather than measured, so a
record airing twice is the first thing to look at. `MAX_HAND_OVERS` STAYS at 3: it covers a
Liquidsoap that restarted and dropped what it held, which is not an audio-availability fact. **The other half is that a record nothing will serve
comes OUT of the order before its slot**: `TrackCachePlanner.ripen` answers with the window's
unfetchable items — absent from `findForBindings` means every copy is benched, and a backoff that
outlasts the item's own projected slot is a miss rather than a wait — and `DirectorService.thin`
marks them `unavailable`, which splices, reopens any break that promised one, and moves `remaining()`
so a refill is sent. The planner judges a backoff against a slot it projects from item durations plus
`COMMITTED_LEAD_MS`, because the head of the warm window is not the record playing now and the planner
cannot see how much of what is committed is left.

**The player fetches every record from the app, and the app is the only thing that fetches a provider.**
`TrackAudioResolver` answers `/playout/audio/{sourceId}` for any binding that is `playable and
missing_at is null` — one URL, on this machine, whether or not the bytes are here yet — and
`TrackAudioService.ensure` behind that route reads the file, a fetch already
running, or the provider, in that order. `deadair.track_audio` says what is on disk under `TRACKS_DIR`
for a BINDING (`track_sources.id`, since two copies of one record within a provider are two files) and
the bytes live in a `ContentStore` beside art and segments. **There is deliberately no provider link in
the resolver chain**: a provider URL is fetchable only from wherever it was minted for, so a chain that
sometimes handed one to the player was deciding, silently and per deployment, whether the URL worked at
all — which is why `SpotifyShimClient` now has ONE address (`SPOTIFY_SHIM_CONTROL_URL`, with
`SPOTIFY_SHIM_URL` kept only as a fallback) and why a signed shim URL is valid anywhere, the token
covering the track id and the expiry rather than the host. **Every fetched record is KEPT**, and the
`playout.trackCache` switch that used to make that optional is gone: its off state meant the station
neither served from the cache nor filled it, which stopped being expressible once a record may not be
committed until its audio is here — a station keeping nothing would have nothing ready and would never
commit. A/B-ing a suspected bad file is done by deleting the file, since `locate` treats a row whose
file is missing as a re-fetch and repairs the row. The bill is that `TRACKS_DIR` grows without bound;
see `docs/todo/track-cache-eviction.md`. Four things are load-bearing: over the cap or under the floor
**serves and stores nothing**, because a truncated record airing is worse than an item the player
skips; every failure is a row with a doubling backoff rather than a throw; `attempts` counts
CONSECUTIVE failures, which is why `recordSuccess` resets it (a record fetched forty times and refused
four has an intermittent upstream, not a copy to write off); and de-duplication is an in-process map
covering the LOOKUP as well as the download, because the read that decides whether to fetch is itself a
round trip. `TrackCachePlanner.ripen` warms `CACHE_AHEAD` items past the cursor off the director's
commit pass — **before** the commit rather than after it, which is a reversal: the old ordering was
argued from the items handed over this pass being past the cursor by then, and the window now LEADS the
commit lead so that a record's bytes are here several boundaries before its slot. Two fetches per pass,
and it is the only place the backoff is read (a request for bytes something is waiting on ignores it).
`CACHE_AHEAD` lives in `track.audio.service.ts` rather than in the planner that owns the window, for the
reason `TRACK_PACE_MS` lives in `AnalysisService`: the planner imports the service, and the cycle the
other way throws `Cannot access 'CACHE_AHEAD' before initialization` under Node's ESM loader while
loading fine under vitest. **Four consecutive failures write off the copy** — `TracksRepository.markBindingMissing`
sets `track_sources.missing_at`, which every reader already excludes on, so one statement takes the
binding out of rotation, binding selection, measurement and the running order. It is a BENCH, not a ban:
`upsertTrackSource` clears the mark on every re-sighting, so the hourly `catalog.sync` un-benches a copy
the provider still lists and it gets one more attempt. That is why the column is `missing_at` and not
`playable`, which nothing clears and which would bench a record for good over an outage. Nothing evicts
yet.

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
and the console says `ready` for it. The count is polled from Icecast, which is the truth, off
whichever stats endpoint that Icecast has: `/admin/publicstats.json` on the 2.5.0 the compose file
runs (read as the admin user, since access under `/admin/` is a role decision an operator can
tighten) or `/status-json.xsl` on a 2.4 (which 2.5 deprecates). Whichever answers is cached, so the
other is probed once per re-probe rather than once per poll. **The two documents carry the same facts
in different shapes, and neither matches what upstream's source suggests** — `listenersForMount` is
where that lives, and `docs/todo/icecast-2.5.md` records both measured payloads.

**The FEED is the mechanism and the poll is the failsafe.** `IcecastEventFeed` holds
`/admin/eventfeed` open and `icecast.eventfeed.parse.ts` deliberately does not filter on the trigger,
so it takes the count off whichever event carries one — and `source-listeners-changed` is emitted on
every change in either direction (`src/source.c`), with an authoritative total, reaching the feed with
no `<event-bindings>` config because `event.c` hands every event to the stream unconditionally. So
both edges arrive within milliseconds and `AUDIENCE_POLL_MS` is a minute, covering only what the feed
cannot: a 2.4 server, a dropped feed, and the window before the poll that discovers the admin endpoint
has attached it. **Icecast's `listener_add`/`listener_remove` hooks are GONE** along with
`listener.credential.middleware`, `stream.listenerHooks` and `POST /playout/bridge/listener`: they
existed to beat a five-second poll to an arrival, which the feed now does without holding a listener's
own connection open on a blocking auth call to this app — and with them went the property that a dead
API refuses new listeners at the door. `AUDIENCE_LINGER_MS` is five minutes and means only what it
says now, since it is no longer cover for a missed departure: how long the mount is held for somebody
who might come back, at the cost of five minutes of fetching per departure. **Only a positive reading
can close the gate** — a failed poll calls `settle()` without touching the count — which is why there
is no longer an `audienceUnknown` check: it reported a `fault` saying the station "stays silent either
way", true only when the last answer happened to have been zero. Off air the transport hands over NOTHING and the falling edge
calls `/control/offair` at once, because Liquidsoap keeps consuming the playout queue whether or not
`driving()` selects it (measured: `remainingMs` falls with the wall clock while `driving` is false).
Anything left queued plays out to an empty mount at a download per track, which is the cost the gate
exists to avoid. A warm queue is therefore not available from the app side; it would take a clock
change in `radio.liq`. **The console does not play the mount**, deliberately: it used to carry a
`StreamMonitor`, and the console is the wrong place to listen to a radio station. The consequence is
worth knowing rather than working around — an operator with the console open is no longer an
audience, so in `audience` mode a station with nobody actually tuned in stays silent while they
watch it, which is the gate telling the truth rather than a fault.

**Every gate that can silence the station says so, in ONE ordered answer.** `silence.diagnosis.ts` is
ten gates over a `StationFacts` snapshot, pure so the precedence can be tested without a stack, and
`PlayoutStatus.silence` carries the verdict on the reading the console already polls — so the badge,
the strip and the `/onair` panel read one answer instead of the three partial inferences they each
used to derive. **The ordering is causal**: a stalled reconcile loop ranks above `streamUp` and
`driving` because both are set by calls that loop makes, so a stopped loop leaves them frozen at
whatever they last said and nothing below it can be trusted. Three rules keep it honest. `waiting` is
its own state rather than a mild fault, because a station idling for want of a listener and one that
cannot reach its stream are both silent and only one wants fixing — the same argument the `ready`
badge exists on. `configNotAdopted` is reported and **never the cause**, since a station can air
perfectly well to somebody who connected before the config was replaced. And `notDriving` is the
RESIDUE: dropping the lease is what the dead-man switch and the audience gate are FOR, so it is a
fault only when nothing above accounts for it. Nothing is stored; the one database read is
`station_air`, because whether an operator stood the station down is the only fact not in memory. A
cause CHANGE is logged on the edge, keyed like `StreamConfigWatch`'s warnings, and it is written to
`deadair.station_events` on the same edge, which is what makes "why was the station quiet at 3am"
answerable at all.

**The activity feed is a union of three tables and owns only one of them.** `GET /activity` reads
`deadair.station_events` (the station's own moments: a silence cause changing, an air toggle, a gap
that outlived the loop meant to close it), `segment_events` (a break's journey, written since
migration 0008 precisely so a feed could be a transport over rows that exist) and `play_history`
(what aired). **Neither of the two existing tables is copied**, because a fact with two writers is
two things that can disagree and no reader can tell which one lied; `script_history` is not a fourth
source either, since a break already appears through its segment rows and one row per write ATTEMPT
would report one break as four lines. Three rules hold it up. **Producers write on EDGES**: the
console polls the transport twice a second, so a row per reading would make this a log file with a
primary key, which is also why the ordinary sub-second first-listener gap is kept out entirely and
only a recovery long enough to have mattered is recorded. **`ActivityRecorder` never throws** and
every caller `void`s it, because nothing reads a row here to decide anything and a failed insert
must never cost the station the thing it was describing. And **the sentences are written outside the
SQL** (`activity.feed.ts`), because two of the three sources hold facts that were never phrased for
a reader and composing them inside a `union all` would put station copy where nobody would find it.
The cursor is a keyset over `(created_at, id)` rather than an offset: rows arrive at the head
continuously, and the id is half of it because a stand-down and the poll behind it land in the same
millisecond. `apps/api/scripts/activity.smoke.ts` is what covers the union, since the interesting
part is SQL.

**What writes to it, and the two rules learned by running it.** Beyond the transport's own edges
(`silence.cause`, `gap`) the producers are the director (`air.on`/`air.off`, `order.caughtUp`,
`item.skipped`, `break.claimStale`, `set.generated`), the render path (`break.degraded`), the catalog
(`binding.benched`, `track.discovered`) and the two operator surfaces (`order.*`, `airMode.set`,
`plugin.*`), which are the only ones that stamp `station_events.actor_id`. **A catch-up is ONE event
carrying a count, not one per item.** `StationLineup.markAiring` answers how many it passed over
because that number exists nowhere else, and the first version of the feed reported only the narrow
case — a break not ready when its slot came round — so a dropped stream wrote off twenty committed
items in silence. Twenty rows would have been the opposite mistake. **The feed carries the station's
own sentences and never a third party's text**: nothing here is redacted, which is safe only while
every `detail` is written by app code, so an upstream body, a provider's response or a plugin's
message must be summarized rather than quoted. That is also the line between this and `PluginLog`,
which scrubs tokens and sits on `platform.manage` precisely because plugin output goes through it.

**Zero listeners and an Icecast that stopped answering are the same number and opposite facts.**
`IcecastStatsClient.listeners()` returns `undefined` for "could not read" and documents that as
deliberately not `0`; `AudienceWatch` used to discard it, so a dead stats endpoint read as an empty
room and in `audience` mode the gate then never reopened — silent for good, console saying `ready`.
`AudienceWatch.reading()` keeps `readAt` beside the count, stamped in `accept()` because that is the
one place a poll and an event-feed message meet, and both are proof Icecast is alive. **The gate
itself is deliberately unchanged**: an app that cannot see Icecast has no evidence anybody is there,
and airing on a failed request would be the worse mistake. What that means in practice is that only a
POSITIVE reading moves it — a failed poll leaves the last count standing rather than reading as an
empty room — so an Icecast that dies while somebody is listening does not take the station off air.

**A heartbeat is not a health check.** `modules/shared/heartbeat.ts` is a map of name to two
timestamps and holds no opinion about thresholds, because a five-second poll and a nightly sweep are
both healthy and no one number describes both: it answers how long it has been and the reader
decides. `register` keeps boot from being a special case, so a loop is measurable from its first
millisecond without every caller inventing a grace window. A FAILURE stays beside the loop
(`PlayoutPusher.lastFailure`), because a loop that threw and came round again is still alive and
folding the two together leaves a reader unable to tell a loop that stopped from one failing every
pass. The beat is skipped for a pass that threw and taken for one that returned early — the several
`return`s in `reconcile` are the loop working. Two of the five timer loops have adopted it; the rest
are one line each on the day something reads them.

**Two database pools.** The runtime pool connects as the non-owner `app_user` role so RLS actually enforces; a separate owner pool handles privileged maintenance.

**The console is a broadcast desk, and the design language is enforced by structure rather than by
discipline.** `apps/web` is Mantine v9 and nothing else — no CSS-in-JS, no utility framework. The
system has four parts and each exists because the alternative already went wrong once.
`src/theme.ts` is the whole palette and every component default: the neutral, accent and status
tuples all OVERRIDE Mantine's built-ins (`dark` and `gray` for carbon, `red`/`blue`/`yellow` for the
tally conventions, `teal`/`green` for phosphor, `grape` and `orange` for authored-by-the-station and
for the one deliberate half-step between `skipped` and `unavailable`), which is why a `color="red"`
written anywhere already means the retuned red and why **overriding `gray` alone is not enough** —
in dark mode Mantine draws every surface from `dark`. `src/tokens.css` holds the `--da-*` surfaces
the theme's `cssVariablesResolver` points at, plus the one keyframe (`da-lamp-pulse`, for genuinely
live things only) and the `da-scanlines` texture, which goes on CHROME and never on content.
`src/components/shared/status.ts` is the one status vocabulary — five tones, no surface names a
colour for itself — and `status.lamp.tsx` draws it two ways, a quiet dot on a busy card and a filled
chip for the one state worth seeing across the room. And `src/components/shared/` holds
`PageHeader`, `ErrorAlert`, `EmptyState`, `Eyebrow`, `PageSkeleton`: the console had these
hand-rolled 20, 44, 9, 5 and 12 times, which is how it ended up with three letter-spacings for one
label and six heights of skeleton. **Type is Mantine's own scale and stays that way** — it was set a
step smaller for one pass to buy density, which is a uniform scale-down, reads as the browser being
zoomed out, and costs legibility rather than earning rows; density belongs in `spacing`, table
`verticalSpacing` and card padding. **Do not hand-roll one of these again**, and put a `Card` or
`Table` convention in `theme.components` rather than in a wrapper. Two rules that are not cosmetic:
a nav or back link uses `renderRoot={props => <Link to="..." {...props} />}` and never
`component={Link}`, because the polymorphic form erases the router's typing and hid a `/lineups`
link pointing at a route that never existed; and columns of figures carry `.da-num`, because a
playhead in proportional digits makes the whole row twitch on every tick.

**Import aliases** are `#src/*`, `#routes/*`, `#modules/*`, declared as `paths` in
`apps/api/tsconfig.json` (there is no `imports` field in `apps/api/package.json`; docs that say
otherwise are stale). `#shared/*` is declared but points at a `src/shared` that does not exist:
shared code lives in `src/modules/shared`. Local imports carry `.js` extensions.

**Formatting and toolchain:** 4-space indent, single quotes, semicolons, print width 150, `arrowParens: avoid`. Node 26+, TypeScript 6, pnpm + Turborepo. `pnpm test` / `pnpm lint` / `pnpm build` run through turbo; per package, `pnpm --filter @deadair/api test`. Tests live in each package's top-level `tests/`, mirroring `src/`.

**Neither `tests/` nor `scripts/` is built, and both are type-checked.** `pnpm --filter @deadair/api typecheck` is `typecheck:tests` (`tsconfig.tests.json`) then `typecheck:scripts` (`scripts/tsconfig.json`), and both widen `rootDir` to the workspace root — `rootDir` is a rule about where EMIT inputs may live and there is none, while pinning it rejects a boundary fixture from `packages/plugin-sdk/tests` and `verify.speech.ts` importing the kokoro plugin, both of which are deliberate. Neither folder is in the build tsconfig, so `tsc` still compiles only shippable code. This is not decoration: vitest transpiles without checking types and the scripts had no runner at all, so both folders had silently stopped compiling against the code they cover — four of five smoke scripts at once.

## Multi-package work

Larger features run as numbered handoffs under `.claude/handoffs/<nnn>-<slug>/`: a `_run.md` stating the goal, the package list with agent roles, and the dependency edges and why they exist, then one file per package with a matching `.result.md` written back when it lands. Completed run directories are the record and are not edited by later runs. Follow the existing shape when starting a new one.
