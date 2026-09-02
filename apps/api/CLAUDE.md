# The station: chassis

How `apps/api` is wired underneath any one subsystem — module lifecycle, configuration, settings,
plugin selection, the database connections and the import aliases. What each MODULE does is in the
files under [`docs/internals/`](../../docs/internals); this is the ground they all stand on.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## A setting is a string, and that is the whole of it

**Every layer of `AppConfig` holds STRINGS, so an on/off setting is read through `settingIsOn` and never as a
boolean.** `AppConfigSourcePostgres.load()` snapshots each `deadair.settings` row as the raw text of its
`value` column and parses nothing (its `tryParseJson` serves only the single-key `get()` behind a `${pg:…}`
reference, which is not the path a module read takes); dotenv is the same. So `config.get(key, false)` answers
the STRING `'false'`, which is truthy — every switch written that way could be turned on and never back off,
in silence, with the console showing the change and the table holding it. That was live in six places,
including `rotation.discover` and all three `llm.*` model switches, and in `OTP_DEV_BYPASS`, where `false` in
a `.env` ENABLED the bypass and only the positive `NODE_ENV` allowlist beside it kept that from mattering.
`modules/shared/setting.flags.ts` owns the vocabulary now (`true/1/yes/on`, `false/0/no/off`, anything else
and the empty string take the declared default rather than `false`, because a value nobody can parse is a
setting nobody set). Numbers have the same problem and the same shape of answer: `resolveAnalysisConcurrency`,
`resolveRetentionDays`, `maxOutputTokens`.

**A test that hands over a real boolean proves nothing here** — it passes either way — so a switch's off-case
is tested with the string, and a config double that coerces on the way out is worse than no double at all:
`model.set.generator.test.ts` had one for as long as it existed and hid this bug the whole time.

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

**Settings are declared in `settings.registry.ts`** as the plugin SDK's `ConfigField`, which is what lets one
console component render both a plugin's settings and the station's. `GET`/`PUT /settings` are the operator
surface; a `secret` is reported as a configured-boolean and never as a value. The registry is not where a
setting is READ — each module keeps its typed resolver (`resolveStreamSettings`, `parseAirMode`,
`stationRules`) and shares the registry's defaults so the two cannot disagree. A row nobody declared is left
alone rather than deleted.

**A `number` shares its RANGE for the same reason it shares its default, and the two sides of that range
answer differently on purpose**: the resolver CLAMPS, because it is reading a row that is already stored and a
setting that refuses to load stops the walk behind it, while `serializeSetting` REFUSES, because that is
somebody typing one and a clamp there stores a figure they did not ask for and shows it back as though they
had. The console clamps too, where the number visibly changes in front of them. Undeclared bounds were how
`analysis.concurrency` accepted 400 and ran at 32. Still constants, deliberately: the four mixer knobs,
because the real work there is a Liquidsoap restart (`docs/todo/mixer-settings-in-db.md`).

**Some lengths are RANGES, and the resolvers behind them are the only ones here allowed to be random.**
`render.productionMinutesMin`/`Max`, `render.dialogueMinutesMin`/`Max` and `rotation.newsStoriesMin`/`Max`,
because a programme that is always exactly the same length is the one thing about a schedule a listener
notices without being able to say why. What makes a non-deterministic resolver safe here and nowhere else is
that the answer is read ONCE and stored — `stationTargetMs` is called at commission and goes straight into
`productions.target_ms`, and every pass afterwards reads the row — so there is nothing for a second roll to
contradict; `random` is a parameter for the reason `storiesFor`'s `now` is one. Both ends are read as an
unordered PAIR and clamped, on the resolver rule above.

**Which lengths are worth ranging is measured rather than assumed**: a BREAK is given a ceiling rather than a
budget and the model stops where it stops, so talk breaks already span 3 to 100 words around a median of 28
and randomising `rotation.breakWords` would be a no-op — only a production's `target_ms` and a bulletin's
story COUNT are the mechanical kind, which is why those two got it and the word ceilings did not.

## Reading and writing the database

**A SQL NULL reads back as `undefined` while the generated types say `null`, so every optional column
is compared with `== null`.** The driver hands back `undefined` for a null column and
`src/modules/data/db.ts` types it `T | null`, so `row.x === null` is a test that is always false and
`row.x !== null` is a guard that always passes — which is how an undated record arrives at
`Number(undefined)` as `NaN` rather than being dropped. Around a dozen repositories carry a comment
pointing at this rule, and until the file was split it pointed at a paragraph that had never been
written: it lived only in one person's notes, which is the failure mode of a rule everybody knows and
nobody wrote down. The convention on top of it is that a repository's row mapper DROPS an absent
optional rather than passing it through, so the shape reaching the rest of the app is the codebase's
own `undefined`-means-not-set and never a third state.

**Two database pools, and the isolation they are FOR is not built.** The runtime pool connects as the non-owner `app_user` role (created `nobypassrls`, granted DML only) and a separate owner pool handles privileged maintenance, so the runtime path cannot alter the schema. That is all it currently buys: **no migration declares a single RLS policy**, there is no organization table to isolate by, and the four `app.actor_*` GUCs set on every request transaction and every `TransactionalJob` are read by nothing — no trigger, no policy, no `current_setting` anywhere. Nine places used to state or imply otherwise, including this one. `docs/todo/row-level-security.md` records what would have to be built and, more importantly, the one thing that must not happen: **the per-request transaction must not be deleted on the grounds that its RLS justification was fiction.** Its other two reasons are live — `AfterCommit` running when the work is durable, and a job enqueued during a request committing atomically with it — which is why the exempt branch runs `AfterCommit` itself.

**Sessions outlive the database.** Sessions and refresh-token families live in Redis, actors live in
Postgres, so a schema rebuild wipes one store and not the other and leaves browsers holding tokens
that verify against a user who no longer exists. The root `rebuild:data` and `db:reset` scripts
therefore end in `pnpm flush:sessions` (`redis-cli FLUSHALL`); a reset that skips it hands the
operator a session with no actor. The API rejects that state rather than trusting it, in
`authorization.context.middleware` for authenticated requests and in
`AuthenticationService.revokeIfSubjectIsGone` for the refresh grant, both of which revoke the
session and answer 401 instead of letting it through as a user who holds no permissions.

## Module lifecycle

**Module lifecycle order is load-bearing, and SHUTDOWN runs in REVERSE registration order.** The list in
`apps/api/src/modules/modules.ts` is ordered deliberately and the comments there explain each placement.
`PluginsModule` sits after everything its host reaches into, and `PlaylistsModule` after `PluginsModule`. Work
the first request does not depend on belongs in `ready()`, after the socket is up, not in `start()`. ServerKit
walks ONE list both ways, forwards to build and backwards to tear down, so a module releases what it holds
while everything it depends on is still alive — which is what you want almost everywhere and means the
position is simply a dependency order.

**The counter-intuitive half is at the TOP of the list: a module that must close LAST registers FIRST.**
`LoggingModule` is first so the log store closes after every other module's shutdown logging has flushed
through `DeadairLogger`, and `DataConnectionsModule` is second so the pools outlive every module that writes
during its own teardown — `DataModule` has to register early because everything resolves what it registers,
and closing in its own position is what once left every module tearing down against a destroyed driver, losing
the director's flush of the running order, which is a guarantee rather than a nicety, on nine of the shutdowns
in one log. Both are shutdown-only modules, so sitting ahead of `HealthModule` costs boot nothing.
`JobsModule` sits after `PluginsModule` for the same reason read the other way: registering later is what
stops the workers before the plugin instances under them are disposed.

And **no hook may cost the others their teardown, or the process its exit**: the reversal did not touch this,
the shutdown loop still catches nothing and bounds nothing, unlike the `ready` loop above it, so
`withBoundedShutdown` wraps every hook at the list. A hook that hung left fourteen processes in that log still
running their loops after being told to stop, one of them probing Liquidsoap for hours on a rotated secret.
`apps/api/tests/modules/modules.test.ts` holds the whole ordering, and reads every assertion through a
`tearsDownBefore` helper rather than through raw positions.

**A `ready` hook that throws is logged and boot carries on, so a hook the station cannot run without has
to stop the process itself.** ServerKit's ready loop is fault-isolated, which is right for a cache warm
and was wrong for `JobsModule`: the runner is what consumes every row the director enqueues and what
fires every cron, and with its `start()` failed the process printed "Boot complete", served every route
and answered `/health` 200 while the running order ran out with nothing to fill it. That module now
catches the failure, sets `process.exitCode = 1` and sends itself `SIGTERM`: the same graceful close a
supervisor's stop takes, so every module still tears down in order and the log store flushes the line
that says why. Nothing else in the list has earned that; a new hook that does should copy the shape
rather than call `process.exit`, which skips both. `setup.server.ts` installs the same shape on
`unhandledRejection` and `uncaughtException` right after the logger exists
(`server/crash.handlers.ts`), so a rejection that used to take the process down silently now names
itself first.

**Logging is process-level and predates DI.** `RotatingLogStore` is constructed in
`setup.server.ts` before any container exists, published through `setLogStore`, and wrapped by
`DeadairLogger` so every module's lines land on stdout and in `logs/`. `PluginLog` tees plugin
output to the app logger plus a per-plugin rotating file with its own verbosity gate. Malformed
`LOG_MAX_*` values fail loudly at boot by design, through `requiredNumber` in
`modules/shared/setting.numbers.ts` — the numeric sibling of `settingIsOn` and there for the same
reason, since **every layer of `AppConfig` holds strings and `get`'s overload widens its return from
the DEFAULT**, so a set value arrives as text while TypeScript reports a number. This claim was in
the tree for a long time before anything implemented it, and what an unvalidated `LOG_MAX_BYTES=2MB`
actually produced was a store that threw on every append into a wrapper that cannot report one: a
healthy-looking server with an empty logs directory. `LoggingModule` owns only the store's shutdown
and reaches it through `getLogStore()` rather than the container, because the DI token is registered
by `PluginsModule`, which tears down long before it.

**`/logs` is the read side of that store, and `LogsService` reaches it through `getLogStore()` for the
same reason `LoggingModule` does.** For a long time `/plugins/{id}/logs` was the only log route there
was, so the one file carrying every subsystem could be read only by somebody with a shell on the box
— which the single-container deployment exists partly to make unnecessary. Three sources, a closed
table in `modules/station/logs.sources.ts`: the app channel, and the audio chain's and the shim's own
files, which `stream/radio.liq` says were put on disk so all three could be read on one timeline.
Their directory is `STREAM_LOGS_DIR`, or the sibling `streamlogs` of `LOGS_DIR` when nothing set one,
which is already right for the production image and deliberately absent in the dev tree, where the
API cannot see those files at all. **Neither of those two is rotated by anything**, so both the tail
and the download read a bounded number of bytes off the END of the file through
`logging/file.tail.ts` rather than reading the file — a `readFile` there is a read of however much
disk the operator's uptime has earned. The route is `platform.manage` rather than `platform.view`,
on `traces.ck`'s argument plus a concrete case: at `LOG_LEVEL=4` the harbor logs every header of
every control call, so the bridge secret can be in `liquidsoap.log` in plain text.

## Plugins, from the host side

**A capability with several plugins and no setting picks the FIRST, and says so.** `selectPlugin`
(`modules/plugins/plugin.selection.ts`) is one rule shared by `render.speechPluginId`, `llm.pluginId` and
`analysis.pluginId`, because a capability that answers differently depending on which subsystem is asking is
the failure that file exists to prevent. It used to answer nothing here, arguing that a pick the operator did
not make looks deliberate — which weighs a wrong-looking choice against SILENCE, and for speech silence is
what it cost: installing a second TTS plugin took the station off the air until somebody visited a settings
page, while everywhere else the station has this choice it degrades instead (the writer registry falls
through, the set chain tops up, the floor cannot fail). The objection is answered by SAYING SO —
`explainDefaultPick` names what was chosen and what it was chosen over, written once on the edge
(`defaultPickIsNews`, module state because all three services are SCOPED and `speaker()` runs on every commit
pass). Three things stay true.

**A setting naming a plugin that is not a candidate still answers nothing without falling back**, because that
is an instruction where the other is a default, and quietly using a different engine is how a station ends up
wrong with nothing in the log.

**"First" means `byPluginId` order**, so every caller sorts — `AnalysisService.candidates` was the one that
did not, which "first" made load-bearing rather than tidy. And `explainNoPlugin` now has two branches rather
than three, since several-and-none-chosen is no longer a refusal.

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

## Conventions

**Import aliases** are `#src/*`, `#routes/*`, `#modules/*`, and they are declared THREE times
because three different things resolve them, none of which can read the others. `paths` in
`apps/api/tsconfig.json` type-checks them and nothing more: `tsc` never rewrites an emitted
specifier, so `dist/` still asks for `#src/...`. `apps/api/package.json#imports` is what answers
that at RUNTIME, and it is conditional — `dist/` by default, which is the whole reason `node
dist/index.js` works in a production image, and `src/` under the `development` condition, which
`scripts/dev.watch.mjs` asks for with `--conditions=development` so a stale `dist/` can never be
preferred over the file just saved. `vitest.config.ts` spells the same mapping out a third time,
since its esbuild transform reads neither. Measured: the dev loader's own resolver satisfies these
through tsconfig before the imports field is consulted, so the condition flag is a belt-and-braces
guarantee rather than the mechanism. `#shared/*` is gone — it pointed at a `src/shared` that never
existed; shared code lives in `src/modules/shared`. Local imports carry `.js` extensions.

**Neither `tests/` nor `scripts/` is built, and both are type-checked.** `pnpm --filter @deadair/api typecheck` is `typecheck:tests` (`tsconfig.tests.json`) then `typecheck:scripts` (`scripts/tsconfig.json`), and both widen `rootDir` to the workspace root — `rootDir` is a rule about where EMIT inputs may live and there is none, while pinning it rejects a boundary fixture from `packages/plugin-sdk/tests` and `verify.speech.ts` importing the kokoro plugin, both of which are deliberate. Neither folder is in the build tsconfig, so `tsc` still compiles only shippable code. This is not decoration: vitest transpiles without checking types and the scripts had no runner at all, so both folders had silently stopped compiling against the code they cover — four of five smoke scripts at once.
