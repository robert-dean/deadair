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
plugins/*             bundled plugins: spotify, navidrome, musicbrainz, lastfm, wikipedia (the
                      prose the station's facts are extracted from), rss, kokoro (the station's
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
hosted one alike. `llm.pluginId` picks it, mirroring `render.speechPluginId` including its DEFAULT —
see the plugin-selection gotcha. The MODEL is a per-call parameter rather than config, because `plugin_configs.plugin_id` is a
primary key and a station wanting a big model for a show and a small one for an ident cannot express
that by installing twice. Three things stay host-side in `modules/llm/`, deliberately: `LlmGate`,
which holds one model slot **until the words stop arriving rather than until the call resolves**, with
its budget starting at admission and covering the drain; the tool loop, because a tool is a station
function and running one inside a plugin would be the wrong side of the fence; and `ToolRegistry`,
whose sources are an explicit list (catalog search today). A tool declaration goes out and a tool
call comes back, both plain JSON, so nothing executable crosses. **A station with no model plugin is
an ordinary state, not a fault** — `canGenerate()` answers it without throwing, so a writer picks its
deterministic binding.

**A tool call the model wrote as TEXT is still a tool call, and the loop re-issues it.** A
conversation ends when a generation comes back with no tool calls, because that is what an answer
looks like — and a local model does not always agree: one refill's entire final message was
`{"artist":"Mitch Murder","limit":12}`, the arguments of a `similar_artists` call with no call around
them. The loop read it as an answer, `readPicks` found no record in it, and the hour went to the
floor one step before the model would have answered. So `LlmService.runConversation` asks
`strayToolCall` whether the words ARE a call before accepting them as an answer. The rescue lives in
the loop rather than in the parser because `readPicks` is RIGHT to read that object as no records:
what the moment wants is the call to be made, which only the thing holding the tools can do. The bar
is deliberately high, since a false positive turns a real answer into a search and loses it — the
whole message must be one JSON object and nothing else, a named form must name a tool actually on
offer, and a bare argument bag must fit EXACTLY ONE tool (every key declared, every required
parameter present), which is why `{"limit":20}` is left alone and why `{"title":…,"artist":…}` can
never be mistaken for a call. Two bounds: there is no rescue on the LAST step, where withdrawing the
tools to force words is the point, and the replayed assistant turn carries empty content rather than
the stray text, because the transcript is also the model's own record of what it did and it should be
shown the shape to repeat, not the mistake. The raw text survives in the log line.

**A kind of break has SEVERAL writers, and the last one is its floor.** `BreakWriterRegistry` is
keyed by `segments.kind` and holds them in registration order, which IS preference order
(`director.module.ts`): `ModelTalkBreakWriter` in front, `TalkBreakWriter` behind it. A writer that
declines, answers with whitespace or throws is the same outcome — ask the next — so the fall-through
lives there rather than inside any one writer, and `llm.breakWriter` being off is just the first one
declining early. **The floor cannot fail**, which is what makes a slow model cost a better sentence
rather than a silent station. The registry answers with every ATTEMPT rather than only the winner,
because a model that declined and a floor that covered for it are two facts and the second alone
reads as a station that never had a model.

**What the station PLAYS has several generators too, and that chain tops up rather than falling through.** `SetGeneratorChain` is registration order as preference order, exactly like the writer registry (`ModelSetGenerator` in front, `CatalogSetGenerator` behind it, `llm.setGenerator` off by default). The one difference is load-bearing: a break is one sentence and is all-or-nothing, so the writer registry takes the first answer and stops, but a set is `count` picks and a model that named six of fifteen has done most of the job. So each binding is asked for what is still MISSING and the floor finishes the rest, which is why a partial answer is kept rather than discarded. Songs already chosen thread down as `avoidSongKeys`; artists deliberately do NOT, because excluding every artist already queued starves a long rotation of its own library — an artist is spaced within a batch and cooled down once they actually air, which are the two places it can be judged against something real. **The floor cannot fail**, so keep it last. The ONE thing that suspends that guarantee is
`rotation.briefOnly`, off by default: with it on, a generator declaring `SetGenerator.ignoresBrief`
(only `CatalogSetGenerator` does) is not asked while a brief is in force, so a station told "flamenco
guitar" runs short rather than finishing the hour with whatever else the library holds. Three bounds
make that safe to have at all — it applies only where there IS a brief, since an unbriefed station's
floor is not a mismatch but the station itself; the similarity binding is deliberately NOT marked,
because its seeds are records that actually aired and so it draws from the brief's own results
(**that argument does NOT stretch to a PERIOD**, and both middle bindings filter on one themselves —
see the era gotcha); and a
refill it actually cost records says so on the activity feed, because a station that ran dry with a
full library is otherwise two facts with nothing connecting them.

**An opinion is held at three levels and inherits DOWNWARD in both directions.** `artists`, `albums` and `tracks` each carry a `rating` of `-1 / 0 / 1`, written from the console through `PUT /catalog/{artists,albums,tracks}/{id}/rating` (`platform.manage`; the wire spells it `liked / neutral / disliked` and `catalog/rating.ts` is the only place that meets the column, because the ORDERING is what the SQL below needs and nothing outside the database reads it as a number). `CandidatesRepository.effectiveRating` is the one expression that collapses the three into one, and it is **not** a `least()`: a dislike anywhere wins outright, because a dislike is an instruction no lineup may turn off, and otherwise the strongest LIKE carries, because liking an artist means play more of them and liking one song means play that song more. It was a plain `least()` for as long as it existed, which got the veto right and silently swallowed the other half — a liked song on an unrated record by an unrated artist came out `0`, so `weightOf` doubled nothing an operator could produce without rating all three levels identically, and liking a record did nothing whatsoever. Both `sample` and `ratingsFor` go through it so the draw and the resolver cannot disagree. Nothing unit-tests it, since it is SQL: `apps/api/scripts/rating.smoke.ts` is what covers it, against the real database.

**An advisory is a LABEL on a COPY, and the policy over it is not a rotation rule.** `track_sources.advisory` is `explicit` / `clean` / null, per BINDING rather than per track because a clean edit and the explicit original collapse to one `deadair.tracks` row (`resolveTrack` matches on `title_key` + artist and the edit's own ISRC misses) and stay two copies — the binding IS the version, so `rotation.advisory` (`prefer-explicit` / `prefer-clean` / `clean-only`) is almost entirely binding selection in `CandidatesRepository.bindingsFor`, and a work left with no eligible binding falls into the existing "nothing can play this" drop rather than a second mechanism. Four things are load-bearing. It is named for the LABEL and not the words — nothing here reads a lyric, Spotify is passing on a marking — so **`lyrics` stays reserved for the text**, which `docs/todo/track-lyrics.md` wants for a thing the station may read and never say; `content_rating` was rejected because `tracks.rating` already means the operator's `-1/0/1` opinion. It is read at the point of use and deliberately **not on `ResolvedRules`**, because `NO_RULES` zeroes that bag and a setlist — whose whole mechanism is starting from the rules off — would silently begin swearing; it follows `rejectDisliked` instead. The advisory **outranks the operator's provider preference**, since the policy is a rule about content and the provider list is a preference about delivery, and ranked the other way a `prefer-clean` station whose clean copy sits on the second-choice provider is handed the explicit one from the first with nothing saying why. And `clean-only` demands a **positive `clean`**: most providers never mark anything, so a library from one of them plays nothing, which is the honest answer and is paid for in the setting's help text and in `AdvisoryWatch` — it tells that state apart from an empty catalog by asking the same draw again with the policy off, and writes one `station_events` row on the edge. The presenter side is separate and asymmetric on purpose: `speaksClean` is true for BOTH non-default states, because a preference is only a lean about which copy to play when there is a clean twin to choose, and a presenter always has the choice of their own words. Nothing checks the model's answer against it. `apps/api/scripts/advisory.smoke.ts` covers the SQL. **The operator's own account-level explicit filter is reported and never enforced** — the plugin reads `explicit_content.filter_enabled` and `filter_locked` off a profile call it already makes — because the audio comes through the shim rather than the Web API and whether that filter binds on the fetch path is unmeasured; see `docs/todo/clean-copy-matching.md`, which also holds the deferred matcher for a clean copy the playlists never carried.

**A pick is judged where it becomes a track, never inside the generator that named it.** A `SetGenerator` pick is a NAME, so any binding that is not the catalog draw hands over titles nothing has judged — and a dislike is an INSTRUCTION no lineup may turn off, so a generator able to route around it airs a record the operator forbade. The rules therefore run in `PickResolver.resolve(picks, rules)`, the one step every pick from every source passes through. `CatalogSetGenerator` still filters before its own draw and that is NOT redundancy: filtering early keeps the draw from spending its weight on candidates that cannot air, filtering at the resolver makes the rules true for a generator that never read the catalog, and neither is safe to delete because the other exists. `applyRules` composes the three that decide whether a candidate may air; `spaceArtists` runs last and separately, because a batch spaced before its unplayable tracks are dropped closes the gap back up and puts one artist back on its own heels.

**A pick the catalog has never seen is looked up at a provider and INGESTED, and the order of that against the rules is load-bearing.** The library holds what the account's playlists carry, because playlists are the only enumeration a provider offers, so a perfectly good pick outside them used to be dropped. `PickResolver.identify` now falls to `ProviderTrackLookup`, and a hit becomes a real `deadair.tracks` row with a binding — it has to, because the player fetches every record through `track_sources`, so a copy with no binding has no URL. The lookup is STRICT (normalized title and lead artist must both match exactly; duration only breaks a tie), because a near-miss does not error, it airs the wrong record while the console says otherwise. It is bounded per resolve (`MAX_DISCOVERIES`, counted as attempts) since every miss searches every provider, and gated by `rotation.discover`, on by default because off makes the path inert. **Ingest happens BEFORE the rules run**, which is what makes a newly ingested record by a disliked artist get dropped rather than aired for want of an opinion. The other half is `track_sources.origin`: the sync's `markMissingTrackSources` only judges `origin = 'sync'`, because the sweep is an argument about what a playlist WALK saw and a discovered copy is in no playlist — without it the first sync after a discovery benched everything the station found for itself. A walk that later sees a discovered copy moves it into the sweep; a lookup never moves a synced one out. What judges a discovered copy instead is fetching it, via the four-failure bench in `TrackAudioService`.

**ONE search tool, because the split between two was a decision the host could make itself.**
`MusicSearchTool` (`search_music`) reads `deadair.tracks` and fans out over the provider plugins in
one answer, and every row carries `owned`. It was two tools — `search_library` and `search_catalog` —
and choosing wrongly used to be silent and fatal, because a provider pick matched no catalog row and
was dropped. `PickResolver`'s lookup rung ended that, and in ending it turned the split into a
PREFERENCE the model had to arbitrate on every call using no information the host lacks. That
arbitration is where briefed refills died: told to search the library first and reach past it only
when it could not fill the ask, a model briefed `artists like mitch murder` against a library of rock
and metal searched the LIBRARY for one synthwave neighbour after another, got nothing every time, and
ran out of tool steps before it answered. So the preference is now a field rather than a choice: an
owned record is catalogued, bound, usually on disk and measured, and an unowned one is fetched when
it is chosen. Four things are load-bearing. **`ownership` matches the resolver's own keys**
(`title_key` + `artist_key`, the same ones `CandidatesRepository.findByName` uses), because `owned`
has to be the claim `PickResolver.identify` will act on rather than a looser one that reads as free
and costs a download. **Bans narrow BOTH halves now** — `dislikedArtistKeys` is a second read
precisely because a provider row by a banned artist joins to no catalog row and the first cannot see
it — while **rotation rules still narrow neither**, since variety is enforced at the point of choice
and pre-filtering returns a worse pool on a small library. **The providers are reached only when the
library comes up short** (`THIN`), or always if the operator sets `llm.alwaysSearchProviders`; the
default is not merely thrift, because break writers share this tool and theirs check a record already
in the catalog, so under the default a break write never waits on a provider. And **`OWNED_SHARE`
reserves room for the provider half**, or a brief the library HALF matches fills the answer with
owned records and the failure moves from the model's choice into the ordering. A second tool,
`StationTasteTool` (`station_taste`), answers what the operator has liked and disliked; it reports
and never enforces, and `ModelSetGenerator` also puts a short version straight in its prompt so a
model that cannot drive tools still gets the steer.

**The search answers with the LEAD artist, never a credit line, and that is a correctness rule rather than a formatting one.** The model is told to copy a title and artist back exactly, because `ProviderTrackLookup` is strict — and the two steps that then judge the pick both match on the lead artist alone: `PickResolver.identify` keys it off the MATCHED ROW's title and lead (`songKey(found.title, [found.artist])`, so the keys are the ones `play_history` will be written with rather than the words that went looking) and the lookup compares `normalizeKey(track.artists[0])`. The provider fan-out answered `artists.join(', ')` for as long as it existed, so every collaboration it returned was named correctly by the model and then dropped as "not in the catalog" — a live run resolved every solo credit and lost every duet. The other credits ride in `featuring`, which is shown and never copied. Anything new that hands a model a record to name owes the same shape. The related bound is that it must offer enough rows to fill an OVERSAMPLED batch (`MAX_RESULTS` is 25): a model shown ten records and asked for two dozen pads the answer with repeats, `SetGeneratorChain` discards them, and `CatalogSetGenerator` — which cannot act on a brief — quietly fills half the hour.

**One model slot, and it stays one.** `LlmGate` serializes because there is one process with one set of weights on one GPU. Two callers now want it at once — a refill holds it for minutes, a break wants it for seconds — and that is still not an argument for a pool: a second app-side slot relocates the queue to the model host, where there is no `maxWaitMs`, and that timeout is the entire mechanism by which a break writer gives up and lets the floor write. Widening the gate would remove the thing that keeps a slow model from costing a silent station while looking like it was helping. The asymmetry is PRIORITY, not throughput, and it is expressed by bounding the background job (`ModelSetGenerator.BUDGET_MS`), which needs nothing from the gate. **A model budget and degradation tiers are deliberately NOT built** (`docs/todo/station-intelligence.md` §2, deferred against its own ordering claim): every call goes through `LlmService`, so the retrofit is one file, the model is self-hosted so nothing is billed, and "no tier makes music stop" is already structural — the chain tops up and the writer registry falls through.

**A FACT is a claim with its evidence attached, and it is not a plugin's payload.** `deadair.facts`
holds one sentence each, extracted by the host out of prose a plugin handed over, with the span of
that prose that supports it. `source_url` and `source_quote` are `not null` because a claim with no
source must not be EXPRESSIBLE: what a nullable column there produces is a DJ saying something
specific, checkable and untrue in exactly the voice it uses for the things that are true. The split
that makes it work is **a plugin fetches, the host thinks** — `plugins/wikipedia` resolves a record
by its MusicBrainz id through Wikidata and hands over the article verbatim as a `SourceDocument`,
composing no sentence of its own, because only the host can check a claim against the text it came
from and there is deliberately no `llm` capability on `PluginHost`. Documents are stored and never
sent (`forTheWire`), so a better extraction later costs the upstream nothing. **The floor needs no
model**: an article's opening sentence IS a sourced speakable claim and the quote is the same span,
so `fact.lead.ts` fills the store whether or not a model exists, and `fact.model.ts` — off by
default — only adds what a lead sentence cannot carry. Its second call is the whole defence and is
a SEPARATE conversation that has never seen the article, because a model asked to check its own list
in the same breath approves it. `fact_extractions` exists because plenty of articles yield nothing,
and without a mark saying so the pass cannot tell one of those from an article it has never opened.
On air the claims **top up** rather than mix: they fill what they can and the provider `facts` take
the rest, since pooling them would put a template line in front of a sourced one at random. Their
variety comes from different places, which is why — a claim's is the cooldown applied inside the
query, a provider fact's is `chooseFacts`'s `rotate`. The stamp is at SELECTION, so a break dropped
before its slot still rests its facts; that inaccuracy is bought deliberately against a
`segment_events` reader.

**The station's phrasings are the operator's.** `rotation.breakTemplates`, one per line, with the
station's own five as the DEFAULT — so clearing the box restores them rather than producing a silent
DJ, and the way to stop it talking stays `rotation.breaks`. `{{next.title}}` resolves through an
explicit map in `break.templates.ts` (which is why `{{next.album}}` is one row to add when enrichment
lands), `[[double brackets]]` mark a part dropped when it cannot be filled, and a template with an
unknown placeholder is never used and is logged once, quoted. Two rules are the writer's rather than
the operator's: a placeholder outside an optional chunk that cannot be filled means the phrasing does
not apply, and a phrasing saying nothing about the record just finished is only offered where there
is none.

**Who the station IS is a row, and it is a VOICE and nothing else.** `deadair.personas`, one active
per station enforced by a partial unique index, with its own contract and its own console page — a
table for the reason `docs/todo/station-moment.md` argues moods are one: a `ConfigField` describes
one row of a form and this is a list an operator adds to and switches between. It replaced
`llm.breakPersona` and `llm.setPersona`, both retired, and the reason it could not stay two settings
is what putting one on air does: it changes what the model is TOLD (the sheet, in `break.prompt.ts`),
what the station says when the model declined (the persona's own `templates`, ahead of
`rotation.breakTemplates` in `resolveTemplates`), and which VOICE speaks it (`segments.voice`,
stamped by `WriteBreakJob` in the same statement as the words). **It says nothing whatsoever about
what the station PLAYS**, and the `music` line that used to is gone: it was a FOURTH way to steer the
programming beside the three keyed to the clock (`station_lineup.brief`, `schedule_slots.brief`,
`schedule.sustainingBrief`), and two prose descriptions reaching one local model made it split the
difference — so the line had to be withheld from any refill carrying a brief, which was a structural
rule costing a page of explanation in three files. Deleting the field deleted the rule, and
`SetInputs.persona` went with it: the record chooser no longer learns who is presenting at all. The
ten seeds' `music` sentences survive as a comment in `persona.defaults.ts`, because they are exactly
what an operator wants in the brief box, and as a comment rather than a field because pairing a
character with an hour is their call. Five things are load-bearing. **`diction` is not a quirk**: a quirk applies to the sentences
it fits and diction applies to every sentence there will ever be, which is why it leads the sheet AND
is restated after the content rules — the failure it addresses is CAUSED by those rules, since a host
reads seven careful instructions about naming records accurately and answers them in careful, plain
English. **A persona REPLACES the role sentence** rather than queueing behind it, because a model
told both that it is the voice of a radio station and that it is a pirate captain hedges. **The
templates chain rather than merge**, since mixing the pools would put plain English back in at
random, which is the whole failure. **`dictionMarkers` make character checkable** — `readAnswer`
declines a script carrying fewer than `MIN_DICTION_MARKERS`, and declines rather than re-drafting,
because the floor underneath now speaks in the same character and a break writer's one job is not to
be slow. And **a sheet that named no markers passes everything**, because an author who filled in
fewer boxes made no checkable claim and should not have their scripts refused for it.
**A pasted character is not a character**, which is the newest half and the one measured on air: of
seventeen consecutive model breaks under one persona, fifteen ended with a sample line or a signature
reproduced word for word, and every one passed the marker check — because a quoted catchphrase is
exactly the evidence it counts. So `characterFault` now judges four things rather than one, and the
three new ones are each the enforcement of a line the sheet was already sending and nothing was
reading back: a sample may not be echoed (`MAX_SAMPLE_ECHO_WORDS` of consecutive words, since the
lift is as often a clause as a whole line), a signature the station has just used is SPENT, and
`avoid` is checked against the answer at last. **Three of those four are PROHIBITIONS and only the
marker floor asks for anything, which is the split `CharacterContext.dialect` names.** It matters
because a BULLETIN cannot meet the fourth — "no jokes, no opinions" in `NEWS_SHAPE` and "sound like
nobody else" are not simultaneously satisfiable, measured as every news break under one persona
falling to the floor — and the first answer to that was to drop the persona from the news guard
entirely. That was broader than the measurement and re-permitted the exact failure above: `I said
what I said` closing a talk break, a welcome and a news bulletin. So the news writer now passes
`dialect: 'optional'`, which excuses the dialect and keeps the three prohibitions, and it cannot cost
a bulletin because the floor under it is the operator's own news phrasings, which chain no persona
templates. Anything else that wants to be plain wants that flag rather than a missing sheet. The
spent rule is a bargain rather than a trap — the
user turn names which signatures are gone and **invites the model to invent its own instead**, on the
same argument that made the markers get sent: refusing a script for an instruction it was never given
is a trick question, and a model told only what it may not say fills the hole with a sample line,
which is the failure one rule over. Only the phrase-shaped half of `avoid` is checkable, and the
entries describing a subject stay instructions to a model, which is why the grounding rules
underneath them are what actually hold. The four seeds are written from
`persona.defaults.ts` in `ready()` rather than from the migration, so the sheets have one source, and
the guard is that the station is EMPTY rather than that each key is missing — which is what makes
deleting a seeded persona expressible. **Every one of them names a voice, and it is its own key.**
They shipped without one for a long time, on the grounds that which ids exist is a question only the
installed engine can answer — right about an ENGINE id and wrong about the STATION name the column
holds, and it cost the whole roster sounding identical: nineteen sheets, nineteen sets of diction
markers, and a listener hearing one warm American female read all of them, with nothing on any page
saying that was a default rather than a choice. Both bundled speech plugins ship a `DEFAULT_VOICE_ROWS`
map covering every seeded key plus `newsreader`, so a seed resolves on either engine and switching
engines rewrites nothing — which is the entire thing the voice indirection was built for and is only
true while the two maps agree, so `voice.slots.test.ts` holds the three lists together (the seeds say
which names exist, each plugin says what they sound like, and none of the three can import the
others). The slots are the persona KEYS rather than a second vocabulary, on `topics`' argument: one
list to keep straight instead of two and a mapping between them. Deleting a row from a plugin's map
stays expressible, because an unmapped name still falls back to the engine's default and warns once.

**What buys a character room is what the break does not have to say, never the word ceiling.**
Measured before changing anything: 2 of 137 captured answers reached `DEFAULT_MAX_WORDS` and the
median break came in at 28 words, so the ceiling was never what bounded one — the model stops on its
own, and the question is what it spends those 28 words on. It was spending them on content (both
titles, both artists, a note recited) with a marker at the front and a signature at the end, which is
a listing with decoration rather than somebody talking. So the three things that changed all ASK FOR
LESS: a break may hand over ONE of the two records it was shown, the notes are offered rather than
requested (`You do not have to use any of them` — "work at most one of them in" read as an
instruction to work one in, and notes reached 108 of those 137 prompts), and "make one point" is a
rule. Raising the ceiling was considered and rejected on the measurement: it would have permitted
something nothing was asking for. **A rule true of one kind and false of the next belongs on
`BreakPromptShape.rules`**, which is what "make one point" forced into existence — it is exactly
right for a link between two records and a licence to drop two thirds of a bulletin if the news shape
had to read it.

**A character can be given ROPE, and what it buys is the station asking for more rather than
accepting worse.** `personas.latitude` is `loose` / `unleashed` above the ordinary discipline, where
`brevity` is `short` / `one-line` below it, and they are two fields because they are two kinds of
thing: brevity is a habit and only ever changes one sentence of the prompt, latitude is a PERMISSION
and reaches three places at once — the word ceiling (`LATITUDE_MAX_WORDS`), the shape's rules
(`BreakPromptShape.latitudeRules`, which swaps "make one point" for a licence to follow the thought,
swapped rather than appended because a model told both hedges), and at the top rung the content
licence (`LATITUDE_LICENCE`). They compose, since a terse character can be unfiltered, and a ceiling
nobody reaches costs nothing. Four things are load-bearing. **The two ceilings come from one
`maxWordsFor` call** — what the model is TOLD and what `readAnswer` refuses at live in different
files, and a character asked for seventy words and judged at forty has every break declined for doing
as it was told, silently, with the floor writing the lot. **The SHAPE has the veto and the sheet only
offers** (`allowsLatitude`, on for the talk break alone), because a bulletin's accuracy is not a
character choice. **It narrows within station policy and never widens it**: the licence shares its
slot with the broadcast-clean rule and loses to it, so an `unleashed` persona on a clean station
talks clean. And **it switches off no refusal** — `mustNameRecord`, the three prohibitions and the
dialect check all still decline to the floor, which is why the "name a record" rule is repeated
verbatim in both rule sets rather than dropped along with "make one point". The two seeds that carry
one are `shockjock` (`unleashed`) and `conspiracy` (`loose`), the two whose fence
`persona.defaults.ts` already argues, and that fence is an instruction rather than an enforcement.

**Asking for less overshot in exactly one place, and the correction is the load-bearing half now.**
The rule read "naming them is the least useful thing you can do with your one point", and a model
reading that stopped naming them AT ALL: of thirty-nine consecutive talk breaks under one persona,
roughly three quarters named neither record ("Tonight the groove lands. Friend, a cue from Jerez
rises" is verbatim). Every existing check passed them, because they are unmistakably the character
speaking — the listener just has no idea what is playing. So the ask is now both halves in one
sentence (name a record, THEN say what you make of it), and `BreakPromptShape.mustNameRecord` makes
the named half checkable: `named-nothing` declines a script that carries neither title nor artist of
anything it was shown. It is on the talk break ALONE — a welcome frequently has no record and a
bulletin's job is the stories — and `namedRecordIn` is deliberately generous (title, title with any
parenthetical dropped, or artist), because what is being caught is a break about no record at all and
every refusal costs the station the model's sentence.

**Three more things the prompt never said, each one a silence a model filled.** It never said what
half of the DAY it was, because `roughTime` is twelve-hour with no am or pm — right for a listener
who is awake and useless to a model, which said "tonight" through twelve of those thirty-nine morning
breaks while the welcome beside it said good morning, with the persona's own `tonight` marker
rewarding it. `dayPart` covers all twenty-four hours (the greeting deliberately does not; its hole in
the small hours is the stretch "tonight" is RIGHT for), rides the request beside `greeting`, and
`timeClaimIn` intersects whichever claims a script actually made so the narrower window wins. It
never said what to do when a record carried NO notes, only what to do with notes — so a sheet asking
for specifics was the only instruction in the room, and the station aired invented pressing plants,
catalogue numbers and years about records it knew nothing about. And it named worn OPENINGS while
saying nothing about worn vocabulary, which merely moved the repetition into the middle of the
sentence: `overusedWords` counts the SCRIPTS a word appears in rather than its uses (four uses in one
break is a rhythm problem; one use in each of six is a habit) and names them. That last one asks and
never refuses, deliberately — `dictionMarkers` are asked for by name and counted in every answer, so
the cheapest way to pass the character check is to say the marker list again, and a check that
declined over it would be refusing the character for being itself.

**A bulletin does not read a story twice, and what it is not shown is as deliberate as what it is.**
`BulletinSource` took the top `rotation.newsStories` off a newest-first feed with nothing remembering
the last bulletin, so on a feed that had not moved the same three stories went out in twenty-seven
consecutive bulletins across seven hours — which the twelve-hour freshness window permits and a
listener cannot tell from the station being wrong. `ReadLog` is what it now checks against: **in
memory, and that is a decision rather than a shortcut** — what was reported is already durable in
`script_history`, one row per bulletin, so this holds only "may I say it again", a question with a
twelve-hour half-life, and a restart costs one repeated bulletin instead of a migration and a sweep. Memory is the authority and the row is the record, exactly as for the running
order. Keyed on the HEADLINE rather than the item id, because one story carried by two newsrooms is
two ids and one thing a listener hears twice; it does not catch two publishers WORDING one story
differently, and nothing here does. Marked at SELECTION, so a bulletin that never airs has still
spent its stories — the same inaccuracy `chooseFacts` buys, against the same alternative of a second
writer that can disagree. `forget` runs on the way IN rather than when stories are kept, or the one
station that needs it most (a feed so slow every bulletin declines) would be the one whose log never
aged out. **When everything in the window has been read the slot is DECLINED**, on the freshness
window's own argument. The other half is `BreakPromptShape.showsFacts`, off for `NEWS_SHAPE` alone:
the record coming up is shown so the bulletin can hand back in a line, and its NOTES are withheld,
because both false discography claims this station has aired ("released in May three thousand nine
hundred thirty-three") were a model finishing a note it half-understood in the voice it had just
established as the one that reports facts. `NEWS_SHAPE.rules` then closes the two ways a bulletin
runs on, neither of which the 300-word ceiling was ever going to catch: it may not explain a word out
of a story (thin copy is a hole to leave open, not to fill — "Gravity is an inescapable force. It's
why Earth has its atmosphere and orbits the sun" aired as news, twice), and it STOPS when the stories
stop, because one bulletin reported three stories correctly and then wrote twelve more sentences
about the needle sliding into rhythm.

**The format clock is ROWS, and what a break is ABOUT is the operator's own word.** `rotation.clockBands`
was a settings box parsed line by line, which was right while a band was three tokens somebody could
hold in their head and stopped being right the moment a band REFERENCED something: a mistyped line is
silence at a time nobody chose, reported only in a log. `deadair.clock_bands` replaced it (`position`
is the line order that was already precedence, `enabled` is what commenting a line out did, and a
check constraint keeps the anchored and spacing shapes exclusive), edited on the schedule page
because a slot and a band are one question with two answers. `clock.bands.ts` keeps only what was
always the hard half: `nextOccurrence` and the daylight-saving care under it. **Minutes rather than an
SQL `interval`**, for `starts_at_minutes`'s reason — every occurrence is computed in JS against `Intl`,
nothing does interval arithmetic in SQL, and `interval '1 mon'` is not a fixed number of milliseconds
a spacing rule could use.

What a band points at is a **topic**: `deadair.topics`, keyed by `segments.kind`, holding the
operator's own vocabulary with a `config` that is DELIBERATELY SHAPELESS (`break_requests.context`'s
rule — the code for a kind reads what it expects and nothing generic reads it). News categories are
its first kind and `docs/todo/station-moment.md`'s weather locations are the second, which is the
whole reason it is a chassis rather than a news feature; a kind declares itself to `TopicKindRegistry`
with the plugin SDK's `ConfigField`, so the console renders its form with the component that already
draws a plugin's settings and the station's. Two rules are load-bearing. `clock_bands.topic_id`
**cascades** rather than nulling, against the habit of every other reference here: a band that quietly
lost its subject would read a GENERAL bulletin under a category's name, and silence is a state an
operator can see where a wrong bulletin is not. And the subject reaches the writer through
`segments.context` — the planted sibling of a request's context, on the ROW because the words are
asked for several passes after the band claimed the slot — resolved once by `BulletinSource` into a
`BreakSubject`, so the model binding and the floor cannot resolve it differently.

**A story's category is decided by three signals, ranked, and a category that matches nothing declines
the slot.** `news.classify.ts` is pure and runs on the floor as well as under the model, so it may not
fetch and may not fail. A FEED that names its own category cannot be wrong; a publisher's own LABEL is
nearly as good and is what most feeds carry; a WORD in a headline is the weakest by a distance ("chip" is a
semiconductor in one story and a shop in the next), so it catches what the first two miss and never
defines a category. The strongest signal wins rather than the sum, or a long word list would outrank a
publisher who has already sorted their own newsroom — and a word is matched as a WHOLE word, because
`ai` inside "said" and "chain" is most of a front page. Asked for a category it cannot fill, the
bulletin DECLINES on the `clean-only` posture: demand a positive match, say so on the edge through
`CategoryWatch` (a singleton for `AdvisoryWatch`'s reason, keyed by category), and never air the
wrong thing under the right name. An UNBRIEFED bulletin spreads across categories instead of taking
the top three, because a wire is newest-first and three sport stories landing together is a sports
bulletin the station never announced as one; only the ORDER changes, and a story no category claims
takes its turn — on most stations the categories cover a fraction of what the feeds carry. Eleven
categories are seeded on `persona.defaults.ts`'s rule, none naming a feed (only this operator has
one) and `local` naming nothing at all, because only the operator knows their town and a guess would
look as though it worked. **The strongest signal is stated on the FEED**, as a row on the plugin that
reads it, and a category holds only the two fields that are about the WORDS. It was a box on the
category naming `pluginId:feedId` by hand: an id derived from a name written in another form, for a
feed the operator was not looking at. `NewsService.feedCategories()` is how the two meet — the menu
is asked what each feed says it is and the stories are joined to it on the feed id, rather than a
station's opinion being stamped onto somebody else's entry — and the word is matched against the
category's own key OR its label, since a category is written once and named twice.

**A list an operator adds to is a `list` config field, not a box with a separator in it.**
`ConfigFieldType` covers `list` with declared `columns` (`packages/plugin-sdk/src/plugin.config.fields.ts`),
stored as a JSON array of row objects in a string exactly as a `multiselect` stores its values, read
back with `parseRows`, and drawn by the console's one settings form as a table with an Add button.
It exists because `id|Name|address` lines are what a list becomes the moment its entries have parts,
and a mistyped line is a feed the station silently does not have — the same argument that moved the
format clock out of a settings box. Three things are load-bearing. A cell is named POSITIONALLY
inside the form (`f3.0.c1`, `cellNameOf`) and the column's own key is put back on the way out, which
is `nameOf`'s rule one level down: a cell is addressed by path, a dot in a path is a step into a
nested object, and translating dots to dashes would quietly merge a plugin's `a.b` and `a-b` into
one cell. So a column key is shaped however the plugin likes, dots included, and nothing about this
reaches a plugin author. The HOST's allowlist reads a `fromConfig` list through the columns declared
`url` and no others (`addressCells` in `plugin.host.factory.ts`), because `hostnameFromSetting`
accepts a bare hostname and would otherwise put a category called `sport` on the allowlist. And a
column may declare `optionsFrom`, a closed host vocabulary (`station.newsCategories` today) resolved
by the CONSOLE against the station's own tables — the third way a form learns what to offer, and the
only one a plugin cannot answer for itself, since a news plugin has no way to learn which categories
this station holds.

**A CELL's choices can also come from the plugin, which is the second of those three ways reaching
one column rather than one field.** `suggestConfigOptions()` publishes under
`columnSuggestionKey(fieldKey, columnKey)` — `voices.engine`, a dot-joined pair that cannot collide
with a field key because a column key may not contain one — and the form merges it exactly where it
merges a resolved `optionsFrom`. Both speech plugins fill their engine-voice column this way, which
is the difference between a table an operator can complete and one that requires knowing `af_heart`
by heart. **A cell with choices renders as an AUTOCOMPLETE and not a select**, deliberately: the
server's list is what it currently holds rather than the whole vocabulary, so a Kokoro blend
expression and a Chatterbox clip added since the last refresh both have to stay typeable. Being
unable to name a voice the server HAS is a worse failure than naming one it does not.

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

**The station's voice is a plugin, and there are two of them now.** `speech` capability, `plugins/kokoro` and `plugins/chatterbox`. A voice is an opaque station-level id (`host`, `newsreader`, or a persona's own key) that the PLUGIN maps in its own config; the host never interprets it, and engine-specific knobs stay with the engine. That map is a `list` config field with a station name, an ENGINE voice and an optional speed — it was a single-line box of `host = af_heart` entries, which is why this station had 68 voicepacks installed and a map holding the empty string, and why the engine cell is an autocomplete over what the server actually reports (`suggestConfigOptions`) rather than free text with a good placeholder. It stays free text underneath, because a Kokoro blend expression names no single voicepack and a Chatterbox clip may have been dropped in since the last refresh. **Both plugins SHIP a map** (`DEFAULT_VOICE_ROWS`), covering the same twenty slots against their own engines, applied whenever the config maps NOTHING — an absent key, `"[]"`, blank and unparseable are one state, and `shippedUnlessMapped` in each manifest is the single place that decides it. It read `config[VOICES_FIELD] ?? DEFAULT_VOICES_JSON` for as long as it existed, on the argument that this was the opposite call to `rotation.breakTemplates`: clearing that box produces a silent DJ and clearing this one produces a station that speaks in one voice, which an operator may legitimately want. That distinction is not one the console can express. The settings form submits EVERY declared field on every save (`config.fields.form.tsx`, `rowsForSubmission`), so a `list` nobody has touched is stored as `"[]"` the moment an operator edits the server URL beside it — which made never-having-opened-the-form the only way to keep the shipped rows, and an ordinary save the way to lose them in silence. This station lost them exactly that way and the logs are the record: a `deadair.chatterbox` row holding `"voices":"[]"`, nineteen characters collapsed onto a `defaultVoice` of `Axel`, and that a bare name where the clips are filenames, so the server answered 404 and every break went to the floor. The half that is genuinely gone is the ability to ask for one voice by emptying the table; the way to ask for it now is to map the voices onto one engine voice, which is a table an operator can see rather than an empty box that means something. `render.speechPluginId` picks the speaker when several can talk and takes the first in id order when nobody has, saying which — see the plugin-selection gotcha.

**An engine that does not lazily reload is a plugin that must load it back, and the unload rides the stream's own end.** `plugins/chatterbox` is the case: after `/api/unload`, synthesis 503s until `/restart_server` is called (which hot-swaps the engine rather than killing the process, despite the name), so `ensureLoaded` runs before EVERY synthesis rather than once at startup — the previous render's unload may have emptied the server and nothing else will notice. Three things about it are load-bearing. A load that fails **unloads before retrying once**, because a CUDA OOM strands its own partial allocations (3.5 GiB measured on a 16 GiB card) and an immediate retry throws itself at a GPU it just filled. It fails as **`unavailable` rather than `upstream`**, which is what makes a cold start that ran out of budget keep the segment's words on the row instead of writing the break off. And the unload fires from the **audio stream's end** rather than from `speak`, which returns long before the audio does — all three endings count once (drained, cancelled, refused as implausible), and `SpeechGate` serializing the engine is why this needs no in-flight counter the way the previous station's renderer did. `unloadAfterRender` is **off** by default: an unload reclaims roughly 70% of what the model held, because the graphics runtime keeps the rest until the server exits, so it buys a few gigabytes at the price of a load before the next break and is worth it only on a genuinely contended card. The same argument applies to the OTHER model on that card and `plugins/llm` has no equivalent; see `docs/todo/station-intelligence.md`.

**A voice PREVIEW is keyed on what the voice currently IS, not on what it is called.** `VoiceSampleStore.keyFor` folds in `SpeechVoice.spec`, an opaque token a plugin changes whenever the rendering would (`engineVoice@speed`), because the station voice id is exactly the part that does NOT change when an operator edits the mapping under it — the file claimed a remap minted a new key for as long as it existed and could not deliver it. The other half is the HEADER: `/voices/{id}/sample` revalidates instead of carrying a day of `max-age`, since the URL names a station voice and a browser answering the next click out of its own cache means the request never arrives. Measured — with the key fixed and the header not, a remap still played the old voice and the API logged no second render. `/segments/{id}/audio` keeps its `max-age`, where the id really does identify the bytes.

**A segment carries a state per STAGE** — `planned → writing → written → rendering → ready`, with `failed` off the side — because making a break is two jobs with different failure modes: `WriteBreakJob` decides the words and `RenderSegmentJob` produces the audio, each claiming the row with a conditional update so a duplicate send is free. `claimForRender` starts at `written`, which is what makes a retry after a failed render re-speak the words already on the row instead of paying a writer to invent different ones. Throughout, **a segment that is not `ready` is skipped, never waited for**, which is what keeps a broken renderer from ever costing the station silence.

**How the station SAYS a word is a row, and most of them were written by somebody else.** The
lexicon left `render.pronunciations` for `deadair.pronunciations` on the format clock's argument: an
entry that arrives from somewhere carries the article it came from and the sentence that says so, it
can be REJECTED in a way that has to outlive the next pass, and none of the three fit on a line with
an arrow in the middle of it. `applyPronunciations` is untouched and still the whole matcher — one
alternation over the script, longest written form first — and the parser went with the setting,
since a row cannot be malformed. Where the entries come from is `pronunciation.gloss.ts` over the
articles the fact store already holds: English Wikipedia prints a pronunciation key in the lead of
exactly the articles that want one, and reading it costs no request to anybody. Only the RESPELLING
forms, and that is measured rather than cautious — of 539 stored articles 34 carry a bare respelling
and 9 the quoted form, both of which an engine reads as they stand, while two carry IPA, which it
cannot, and a hunt for slash-delimited IPA matches 86 documents of `CD/DVD/Blu-ray` and `June
16/17/18`. **The difficulty is that a gloss is not automatically about the name beside it**:
`Madonna ( chih-KOH-nee)` is about Ciccone, `Stevie Wonder ( STEEV-lənd)` about Steveland, and
roughly half gloss one word of two — not reliably the surname, since `Aretha Franklin ( ə-REE-thə)`
glosses the first name. So the written side is chosen by RESEMBLANCE over a consonant skeleton (a
respelling and a spelling disagree about vowels by design and agree about consonants), and
`CONFIDENCE_BAR` decides whether the station says it unasked or proposes it: 0.5 puts one wrong entry
on air, 0.7 makes seven right ones wait, so it sits in the middle of the plateau at 0.6 and
`pronunciation.gloss.test.ts` is the record of that sweep. Three smaller things are load-bearing. The
schwa is spelled out, because no engine knows what `lə-VEEN` is, and the untouched original is what
becomes the evidence. `rejected` is a STATE rather than a deletion, because the pass re-reads an
article whenever a plugin hands over a new copy of it and a deleted proposal would come back forever.
And the entry is written BEFORE the document is marked read, which is the opposite of how a claim and
its mark land together — they share one transaction and these two repositories cannot, so the only
question is which way a crash falls, and marked-first loses a proposal for good where written-first
re-reads and `holds` recognises it. The same pattern is why `fact.lead.ts` strips a keyword-less
parenthetical now: thirteen claims in this station's store read `Lynyrd Skynyrd ( LEH-nerd SKIN-nerd)
is an American rock band` and were being spoken that way.

**A break is written when its slot comes near, not when it is planted.** Planting stays eager and runs to the end of the order, because the position is what keeps the spacing stable; `BreakPlanner.ripen` asks for the WORDS only within `WRITE_AHEAD` items of the cursor. That is the difference between an hour of forward planning and an hour of model and speech work an operator edit can throw away. Sending is free because the job claims the row first, so the director re-offers whatever is still `planned` on every boundary and a lost job heals itself — and an off-air station writes nothing at all. Note the ordering trap it was built around: the running order is written through a THROTTLE, so a job can pick up a break the persisted row does not hold yet; the neighbours are therefore read before the claim, and absent-from-the-order means early rather than has-no-neighbours. **That rule has exactly one exception, and reading it as absolute cost every welcome the station ever tried to give.** An `interrupt` or `next` REQUEST is rendered before it is injected, so `BreakPlanner.prepareRequested` gives its segment no position on purpose and `DirectorService.injectReady` finds it one once the audio exists — for which absent-from-the-order means neither early nor has-no-neighbours but not placed yet. `WriteBreakJob` therefore asks whether a request is behind the segment before it defers, and `injectReady` carries the re-offer that `ripen` cannot, since `ripen` walks the order and this break is deliberately outside it.

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

**Every layer of `AppConfig` holds STRINGS, so an on/off setting is read through `settingIsOn` and
never as a boolean.** `AppConfigSourcePostgres.load()` snapshots each `deadair.settings` row as the
raw text of its `value` column and parses nothing (its `tryParseJson` serves only the single-key
`get()` behind a `${pg:…}` reference, which is not the path a module read takes); dotenv is the same.
So `config.get(key, false)` answers the STRING `'false'`, which is truthy — every switch written that
way could be turned on and never back off, in silence, with the console showing the change and the
table holding it. That was live in six places, including `rotation.discover` and all three `llm.*`
model switches, and in `OTP_DEV_BYPASS`, where `false` in a `.env` ENABLED the bypass and only the
positive `NODE_ENV` allowlist beside it kept that from mattering. `modules/shared/setting.flags.ts`
owns the vocabulary now (`true/1/yes/on`, `false/0/no/off`, anything else and the empty string take
the declared default rather than `false`, because a value nobody can parse is a setting nobody set).
Numbers have the same problem and the same shape of answer: `resolveAnalysisConcurrency`,
`resolveRetentionDays`, `maxOutputTokens`. **A test that hands over a real boolean proves nothing
here** — it passes either way — so a switch's off-case is tested with the string, and a config double
that coerces on the way out is worse than no double at all: `model.set.generator.test.ts` had one for
as long as it existed and hid this bug the whole time.

**Settings are declared in `settings.registry.ts`** as the plugin SDK's `ConfigField`, which is what
lets one console component render both a plugin's settings and the station's. `GET`/`PUT /settings`
are the operator surface; a `secret` is reported as a configured-boolean and never as a value. The
registry is not where a setting is READ — each module keeps its typed resolver (`resolveStreamSettings`,
`parseAirMode`, `stationRules`) and shares the registry's defaults so the two cannot disagree. A row
nobody declared is left alone rather than deleted. Still constants, deliberately: the four mixer
knobs, because the real work there is a Liquidsoap restart (`docs/todo/mixer-settings-in-db.md`).

**A capability with several plugins and no setting picks the FIRST, and says so.** `selectPlugin`
(`modules/plugins/plugin.selection.ts`) is one rule shared by `render.speechPluginId`,
`llm.pluginId` and `analysis.pluginId`, because a capability that answers differently depending on
which subsystem is asking is the failure that file exists to prevent. It used to answer nothing here,
arguing that a pick the operator did not make looks deliberate — which weighs a wrong-looking choice
against SILENCE, and for speech silence is what it cost: installing a second TTS plugin took the
station off the air until somebody visited a settings page, while everywhere else the station has
this choice it degrades instead (the writer registry falls through, the set chain tops up, the floor
cannot fail). The objection is answered by SAYING SO — `explainDefaultPick` names what was chosen and
what it was chosen over, written once on the edge (`defaultPickIsNews`, module state because all
three services are SCOPED and `speaker()` runs on every commit pass). Three things stay true. **A
setting naming a plugin that is not a candidate still answers nothing without falling back**, because
that is an instruction where the other is a default, and quietly using a different engine is how a
station ends up wrong with nothing in the log. **"First" means `byPluginId` order**, so every caller
sorts — `AnalysisService.candidates` was the one that did not, which "first" made load-bearing rather
than tidy. And `explainNoPlugin` now has two branches rather than three, since several-and-none-chosen
is no longer a refusal.

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

**An item's `artists` is a display credit and its `artist` is the identity, and nothing may take one for the other.** `RundownTrack.artists` is a list because a provider gives one, but half the producers only ever have the credit as a single string: an item built from a playlist holds `['USHER','Lil Jon','Ludacris']` and one `PickResolver` resolved holds `['USHER, Lil Jon, Ludacris']`. So `artists[0]` is the lead only by luck, which is why `artist` exists beside it and why every key comes off that — `play_history`, `songKeysOf` (the generator's avoid list) and the scrobbler. It was `artists[0]` in all three for as long as they existed, so the writer stored `drake wizkid kyla` as one artist while every reader asked about `drake`: no repeat window or artist cooldown could match a collaboration, and Last.fm was sent a credit line as an artist name. **Nothing showed** — the only symptom of a rotation rule that never matches is a station that repeats itself, which is the failure `rotation.keys.ts` opens by warning about. `PickResolver` fills `artist` from the catalog row it MATCHED (or the provider row it just ingested), never from the pick that went looking, so the keys a record is judged by are the ones it will air under.

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
refill's instruction, where the system turn is the standing job). It is now the ONLY thing that says
what to play — a persona is purely the presenter, always, with no switch and no exception — which is
what the `music` line's removal bought: the system turn no longer changes shape depending on whether
this refill was briefed. `station_lineup.persona_id` rides the row beside the brief for the same reason the brief is there,
and `PersonaRepository.presenting` is the ONE place the precedence lives (this broadcast's host, then
the station's active one, then nothing) because the break writer and the record chooser both read it
and a station whose DJ depends on which one you ask is two stations. **A show can be RECAST without
starting a new broadcast**, which is the one thing that precedence used to make impossible: `PUT
/director/air/persona` posts a `recast` command that rewrites `personaId` on the row and nothing else
on it (`StationLineup.recast`, the sibling of `rebrief` and narrow for the same reason), and naming
nobody hands the show back to the station's. The personas page reaches a show only when it named no
host of its own, and `PersonasService.setActive` says so by posting the SAME command with no binding —
what happened rather than what to do — through `AfterCommit`, since the director reads the personas
table on its own connection and would otherwise resolve the row as it stood before the write. The
second half is that **the outgoing host's unaired breaks are written again**: every segment past
`committedThrough` goes back to `planned` and `ripen` asks for it under whoever is presenting now, on
the same terms a broken promise gets. Nothing has to know who was presenting before, because being out
of character is a property of the ROW — `SegmentRepository.recast` takes the INCOMING host and leaves
alone a break already in their character, one with no `personaId` at all (a canned ident, a script an
operator typed), and a `voice` an operator set by hand, which is why the voice is cleared through a
correlated subquery against the stamped persona rather than from a value the caller passes.
`CatalogSetGenerator` ignores it deliberately — approximating an instruction would make the thing
that cannot fail depend on how well a guess landed — so a briefed station whose model produced
nothing gets an ordinary hour rather than a bad impression of the one it asked for.

**A PERIOD is the brief's exact half, and it is the one part the deterministic floor honours.**
`station_lineup.era_from`/`era_to` ride the row beside the brief (and `schedule_slots.era_from`/`_to`
beside a slot's, plus `schedule.sustainingEraFrom`/`...To` for the hours nothing is scheduled),
inclusive four-digit years with either end able to stand alone. Migration 0017 argues in writing that
a slot must carry no structured filters beside its brief, and that is right about genre and mood,
where a dropdown is strictly weaker than prose — "flamenco guitar with a bit of swing" is not a
field. A period is the exception and the station had already conceded it: `set.prompt.ts` tells the
model never to write "80s" in a query and to pass `yearFrom`/`yearTo` instead, because the words do
not work and the numbers do. What being a column buys is `CandidatesRepository.sample` narrowing on
it, so a station asked for a decade keeps playing one with `llm.setGenerator` off entirely — which
prose can never do, since prose reaches a model and nothing else. **Every binding in the chain
narrows on it, and the two in the middle do so for a reason that is not efficiency**: `PickResolver`
drops an out-of-period pick whatever named it, so a generator that names one turns its whole share of
the batch into NOTHING, where declining lets `SetGeneratorChain` top up from a floor that can
actually fill the slot — a short answer beats a doomed full one. `SimilarSetGenerator` is the one
that matters, since it takes 40% of every batch by default and the argument excusing it from
`ignoresBrief` (its seeds are records that aired) is much weaker for a period than for a style: a
neighbour of a 1975 record is stylistically close and easily from 1998. `ChartSetGenerator` filters
too and will come back near-empty against a CURRENT chart under any old period, which is the setting
working rather than a fault — a station wanting both wants a chart from that period. There is nothing to approximate: a
year range is not a guess. Four things are load-bearing. **An unknown year is ELIGIBLE**, the
opposite call to `clean-only` and deliberately — an advisory is a content policy where silence must
not read as consent, and this is programming, where dropping a record the station owns for want of a
tag costs the hour; `deadair.tracks.year` is filled at INGEST from what a provider sent (Spotify's
`album.release_date`, Subsonic's `year`) as well as by enrichment, and never overwritten, which is
what stops that eligibility being a loophole big enough to swallow the feature. **It is sent to the
model WITH a prose brief** rather than instead of one, unlike the `music` line it replaces: a range
and a style are not competing claims and a number cannot be split the difference on. **It is not on
`ResolvedRules`**, for `rotation.advisory`'s reason — `NO_RULES` zeroes that bag and a setlist would
silently start playing any decade — so it is judged in `PickResolver.judge` beside `rejectDisliked`.
And **an era that empties the library runs SHORT rather than relaxing**, on `rotation.briefOnly`'s
own rule, with `EraWatch` writing one `station_events` row on the edge; it must be all-or-nothing
across the draw and the resolver, because a floor that widened would hand the resolver picks the
resolver then drops. The three surfaces that apply it — the draw, `yearsFor` behind the resolver, and
`TracksRepository.searchPlayable` — have to agree, and `apps/api/scripts/era.smoke.ts` is what holds
them to it, since a record eligible for one and not the others is a refill that silently comes back
short.

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
cannot see how much of what is committed is left. **Both of those judgements apply to a CATALOGUED
record only**, guarded on `trackId` exactly as `toPlayerItems` guards the same question one window
later: `findForBindings` joins from `track_sources`, so a record the catalog has never seen is absent
from it for the same reason a benched one is, and reading the two as one fact marked 125 records of a
519-item order permanently unavailable within eight minutes of a fresh install. `withLocalAudio`
carries the same guard, because with no binding there is no id to fetch and cutting at one was a wall
the order could never get past.

**A cold station wakes itself, and says what it is doing.** A commit pass runs on a rundown CHANGE and
nothing else, and off air `WARM_LEAD` is 0 so the change never comes — the pass that would ask for the
bytes is the pass that only runs once they arrive. `WARM_TICK_MS` is the one loop the director has, and
it posts a wake only while `waitingOnAudioSince` stands, so a healthy station pays two comparisons and
a recovered one stops asking without anything turning it off. That wait now means "no RECORD was
committed" at both ends: a segment rides the window for free, so a pass that handed over one break used
to clear a wait every word of which was still true. `TrackCachePlanner` also answers how many records
are actually in flight, which is what splits the one wait into `warmingUp` (working, never a fault) and
`waitingOnAudio` (stuck, escalating). And `warmup` is a segment kind, so a listener who arrives into
the first download hears the station say so — canned from `media/segments/inbox/warmup/` if the operator
recorded one, `WarmUpWriter`'s own phrasings otherwise, one at a time, only with the gate open, and only
while the wait is an ordinary one. It names no record, because the records it covers for are the ones
`thin` may yet remove.

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
eleven gates over a `StationFacts` snapshot, pure so the precedence can be tested without a stack, and
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
fault only when nothing above accounts for it. `warmingUp` is the newest and sits just above
`waitingOnAudio`, splitting a state that had to describe both a station downloading its first records
and one whose provider had stopped answering — it never escalates, because it cannot last: when the
fetches stop the count falls to zero and the check below it takes over with its own clock. It is also
the one gate that must outrank `airing` on a technicality, since `hasProgramme` is true of a queued
holding message and the station would otherwise report itself as broadcasting its show while looping
"give us a moment". Nothing is stored; the one database read is
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
