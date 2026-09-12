# Internals: the running order

One running order per station, owned by the director, and everything that decides what is on it: the
broadcast's identity, the brief and the period it carries, what comes out of it, and the rule that a
record is not committed until its audio is on this machine. The two arguments the rest of the tree
cites by name live here rather than anywhere else: [who owns the running
order](#who-owns-the-running-order) and [bytes before air](#nothing-airs-until-its-bytes-are-here).
Read both before changing either.

Every paragraph here records a measured failure and the fix that was chosen over the obvious one.
Read the ones covering whatever you are about to change. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md).

## Who owns the running order

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

**It was four bugs before it was one rule.** A `lineups` table tried to be a reusable named list AND
the broadcast in progress, and every mechanism that reconciled the two was a defect wearing a
feature's name: the CURSOR, an integer position that could disagree with what had actually aired; the
REVISION, a second version of the order minted so a request could edit one; COMPACTION, a repair pass
over the drift the first two produced; and `Rundown`'s own `queue`/`served`/`airing`, a second copy of
the order made per play. All four were the same bug — a second writer of what airs — so they were
removed rather than fixed, and migration 0007 drops `deadair.lineups` on the way down. Three things
follow and are why this is a rule rather than a tidy-up. A producer says WHAT and HOW SOON and only
the director says WHERE, so a `BreakRequest` names no position. **The schedule is a stored document, a
pure resolver and a timer that posts the operator's own `putOnAir` — never an actor**: it says what
should be on air and never when the changeover happens, because only the director knows where the
track boundaries are. That is why `schedule_slots` has no "current slot" column, why the slot stamp
and `hold_until` live on `station_lineup` (migration 0017), why `ScheduleModule` owns no loop, and why
a clock-fired changeover defers its spoken half to the next track boundary where an operator's own
takes effect at once. And a console state like "who is driving" is DERIVED from facts the director
holds rather than stored beside them, because a second copy is a second writer wearing a third name.

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

**Removing a break MARKS it; removing a record splices it.** `StationLineup.remove` is asymmetric on purpose.
`BreakPlanner` is idempotent positionally and by nothing else — it counts records since the last segment
already in the order — so a spliced-out break left a gap it could not tell from one never planted into, and it
planted another one a boundary later. `removed` is that mark, it resets the walk's count like any other
segment, and it ages out through `trimPast`.

**It is its own state rather than a use of `skipped`**, which would have done the planner's job and nothing
else: `skipped` is the station reaching an item and passing over it (no audio, nothing could resolve it, a
push the player never took) and `removed` is an operator cutting one before its turn, and those are opposite
facts on any page that has to say why the station is silent. Two things read the difference:
`committedThrough` counts every non-`planned` state as the head EXCEPT `removed`, because a cut says nothing
about how far the broadcast has got and counting it would freeze the order in front of it; and
`DirectorService.collectRemoved` retires the segment row behind the cut, leaving a `ready` row alone and
leaving any id still elsewhere in the order alone, since idents come from a shared library and the same row is
legitimately at three slots in an hour.

## What the order is asked for

**The order also carries the operator's BRIEF, and that is why it is on the row rather than in a job
payload.** `station_lineup.brief` is what they asked for in their own words ("heavy metal hits"), as distinct
from `name`, which is only a label. It rides the running order because `onEnd: 'extend'` keeps asking for
more: a theme held in a refill's payload would last one batch and drift back to ordinary rotation within the
hour with nothing saying so. It reaches the model in the USER turn (this refill's instruction, where the
system turn is the standing job). It is now the ONLY thing that says what to play — a persona is purely the
presenter, always, with no switch and no exception — which is what the `music` line's removal bought: the
system turn no longer changes shape depending on whether this refill was briefed. `station_lineup.persona_id`
rides the row beside the brief for the same reason the brief is there, and `PersonaRepository.presenting` is
the ONE place the precedence lives (this broadcast's host, then the station's active one, then nothing)
because the break writer and the record chooser both read it and a station whose DJ depends on which one you
ask is two stations.

**A show can be RECAST without starting a new broadcast**, which is the one thing that precedence used to make
impossible: `PUT /director/air/persona` posts a `recast` command that rewrites `personaId` on the row and
nothing else on it (`StationLineup.recast`, the sibling of `rebrief` and narrow for the same reason), and
naming nobody hands the show back to the station's. The personas page reaches a show only when it named no
host of its own, and `PersonasService.setActive` says so by posting the SAME command with no binding — what
happened rather than what to do — through `AfterCommit`, since the director reads the personas table on its
own connection and would otherwise resolve the row as it stood before the write. The second half is that **the
outgoing host's unaired breaks are written again**: every segment past `committedThrough` goes back to
`planned` and `ripen` asks for it under whoever is presenting now, on the same terms a broken promise gets.
Nothing has to know who was presenting before, because being out of character is a property of the ROW —
`SegmentRepository.recast` takes the INCOMING host and leaves alone a break already in their character, one
with no `personaId` at all (a canned ident, a script an operator typed), and a `voice` an operator set by
hand, which is why the voice is cleared through a correlated subquery against the stamped persona rather than
from a value the caller passes. `CatalogSetGenerator` ignores it deliberately — approximating an instruction
would make the thing that cannot fail depend on how well a guess landed — so a briefed station whose model
produced nothing gets an ordinary hour rather than a bad impression of the one it asked for.

**A PERIOD is the brief's exact half, and it is the one part the deterministic floor honours.**
`station_lineup.era_from`/`era_to` ride the row beside the brief (and `schedule_slots.era_from`/`_to` beside a
slot's, plus `schedule.sustainingEraFrom`/`...To` for the hours nothing is scheduled), inclusive four-digit
years with either end able to stand alone. Migration 0017 argues in writing that a slot must carry no
structured filters beside its brief, and that is right about genre and mood, where a dropdown is strictly
weaker than prose — "flamenco guitar with a bit of swing" is not a field. A period is the exception and the
station had already conceded it: `set.prompt.ts` tells the model never to write "80s" in a query and to pass
`yearFrom`/`yearTo` instead, because the words do not work and the numbers do. What being a column buys is
`CandidatesRepository.sample` narrowing on it, so a station asked for a decade keeps playing one with
`llm.setGenerator` off entirely — which prose can never do, since prose reaches a model and nothing else.

**Every binding in the chain narrows on it, and the two in the middle do so for a reason that is not
efficiency**: `PickResolver` drops an out-of-period pick whatever named it, so a generator that names one
turns its whole share of the batch into NOTHING, where declining lets `SetGeneratorChain` top up from a floor
that can actually fill the slot — a short answer beats a doomed full one. `SimilarSetGenerator` is the one
that matters, since it takes 40% of every batch by default and the argument excusing it from `ignoresBrief`
(its seeds are records that aired) is much weaker for a period than for a style: a neighbour of a 1975 record
is stylistically close and easily from 1998. `ChartSetGenerator` filters too and will come back near-empty
against a CURRENT chart under any old period, which is the setting working rather than a fault — a station
wanting both wants a chart from that period. There is nothing to approximate: a year range is not a guess.
Four things are load-bearing.

**An unknown year is ELIGIBLE**, the opposite call to `clean-only` and deliberately — an advisory is a content
policy where silence must not read as consent, and this is programming, where dropping a record the station
owns for want of a tag costs the hour; `deadair.tracks.year` is filled at INGEST from what a provider sent
(Spotify's `album.release_date`, Subsonic's `year`) as well as by enrichment, and never overwritten, which is
what stops that eligibility being a loophole big enough to swallow the feature.

**It is sent to the model WITH a prose brief** rather than instead of one, unlike the `music` line it
replaces: a range and a style are not competing claims and a number cannot be split the difference on.

**It is not on `ResolvedRules`**, for `rotation.advisory`'s reason — `NO_RULES` zeroes that bag and a setlist
would silently start playing any decade — so it is judged in `PickResolver.judge` beside `rejectDisliked`.

And **an era that empties the library runs SHORT rather than relaxing**, on `rotation.briefOnly`'s own rule,
with `EraWatch` writing one `station_events` row on the edge; it must be all-or-nothing across the draw and
the resolver, because a floor that widened would hand the resolver picks the resolver then drops. The three
surfaces that apply it — the draw, `yearsFor` behind the resolver, and `TracksRepository.searchPlayable` —
have to agree, and `apps/api/scripts/era.smoke.ts` is what holds them to it, since a record eligible for one
and not the others is a refill that silently comes back short — which is why the expression itself is one
exported fragment (`shared/release.year.ts`) rather than three copies of a `sql` template.

**A record is dated by the EARLIER of its two claims, not by the more specific one.** The year sits
on `deadair.tracks` and on `deadair.albums`, each written at ingest from whatever the payload that
created the row carried and never overwritten, so a track first met through a reissue keeps the
reissue's year for good while its own album row — filled later by another track off the original —
has it right. It was `coalesce(track, album)`, preferring the track's as the narrower claim, and that
is wrong in the one direction a period filter cannot afford. Measured on this station's library (766
tracks, 630 albums): 41 records where the two disagree, **33 of them with the track dated LATER**, and
every one sampled a reissue over an original the album row had — `All Along the Watchtower` at 2023
against `Electric Ladyland` at 1968, `Purple Haze` at 1993 against `Are You Experienced` at 1967. So a
station asked for the seventies was quietly refusing its own Hendrix, and nothing said so. `least`
rather than `min` because Postgres's `least` ignores nulls and answers null only when both are, which
is exactly the three cases wanted. The counterexample is a bogus LOW claim (one album in that library
carries the 1900 floor `usableYear` accepts, so its two tracks now read as 1900 records) and it is the
honest trade: a too-early year is a data error with a validated floor under it, and a too-late one is
the ordinary unmarked shape of every remaster a provider sells.

## Nothing airs until its bytes are here

**A record is COMMITTED only once its audio is on this machine.** `DirectorService.withLocalAudio` cuts the
commit pass's candidates at the first record `TrackAudioService.readyFor` does not answer for, so Liquidsoap's
resolve is a read from this app rather than a provider download inside the request it is waiting on — which is
what produced the 2.16 seconds of digital silence in [provider-audio-failures](https://github.com/robert-dean/deadair/blob/71e431d4/docs/todo/provider-audio-failures.md). Four things are
load-bearing and each is argued here: it CUTS rather than filters, because
filtering would commit the warm items and leave the cold one behind them, reordering an operator's sequence by
which downloads finished first; a cold record is HELD rather than skipped, which is the exact opposite of the
segment rule beside it (a break is disposable and a record is not); `readyFor` demands the row's checksum AND
the file, since a row whose file was deleted is repaired by re-fetching on the air path; and it fails OPEN,
because a gate that could not read its own answer would take the station off air within three items over a
transient database fault. `order.waitingOnAudio` is on the feed for a station that has been unable to commit
for `WAITING_ON_AUDIO_MS`, written once on the edge.

**The held-versus-skipped asymmetry is the general rule rather than a record-only one.** A production
block is inserted whole or not at all on the same argument, and the console answers 422 rather than
accepting a record whose audio is not local — so the gate never silently holds a slot open behind an
operator's own add, which is the one way a rule about the commit pass could have reached a page and
lied there.

**With the bytes local the commitment horizon collapsed to ONE**: `COMMIT_LEAD` and `PLAYOUT_LEAD` are both 1
and move together — the pusher can only hand over what the director prepared, and Liquidsoap's `prefetch` is
materialized from the same constant, so raising one alone buys nothing. An operator's edit now lands on the
next record rather than three later, and the price, taken deliberately, is the SECOND skip: measured at ~200ms
onto a resolved item against >1.2s or no boundary at all onto an unresolved queue, so the first skip still
lands and one taken before the replacement resolves does not. `SEGMENT_SLACK` is what keeps a window of one
honest — a segment may produce no player item (skipped, or a talk-over that rides the record behind it), so
segments ride along for free and only RECORDS count against the lead. `RESOLVE_GRACE_MS` is 5s on the same
argument and is reasoned rather than measured, so a record airing twice is the first thing to look at.
`MAX_HAND_OVERS` STAYS at 3: it covers a Liquidsoap that restarted and dropped what it held, which is not an
audio-availability fact.

**A smart shuffle programmes the tail it shuffles, and reads nothing to do it.** With `rotation.smartShuffle` on, `DirectorConsoleService.shuffleOrder` reads the songs aired inside the horizon from `play_history` and posts them on the `shuffle` command, so the edit pass stays synchronous and the director stays the only writer. `StationLineup.shuffleRemaining` then shuffles as before and splits the result: what has not aired lately in front, what has behind, each half artist-spaced by `spaceArtists`, the first seeded with the last record the player holds. Off, it is the plain Fisher-Yates it always was. The keys never reach the activity row: it records that the shuffle was smart, not a copy of the history.

**Prepared is not handed, and the transport never hands over past a gap.** A commit PREPARES a record and
leaves it `planned`. It becomes `handed` only when the pusher gives it to Liquidsoap, and with nobody listening
that never happens (`WARM_LEAD` is 0). So an idle station's next record sits prepared and `planned`, and
everything that draws its line at `committedThrough` (a shuffle, a move, an insert, a break placed at the head)
treats it as tail and can put an unprepared item in front of it. The hand-over used to offer the first PREPARED
planned item wherever it sat, and the player airing it made `markAiring` mark every item in front of it
skipped. Measured on 2026-09-11: a playlist shuffled while nobody was listening went, when the next listener
arrived, straight to the playlist's first record, with 19 items written off. `Rundown.ahead` now stops at the
first `planned` item with no prepared form, and `upcoming`, `queuedCount` and the hand-over all read it, so a
stranded item is neither offered nor counted against `COMMIT_LEAD`, and the commit pass prepares the item that
is really next. The pass then drops the stranded item's prepared form (`Rundown.forgetStranded`, run just
before the lead is read), because that form is a snapshot of it as the NEXT record: its measurement, the
claims checked against the order as it stood, and a talk-over cue written for the boundary it has left, which
is marked skipped with it. Kept, it would air in that form whenever its turn came round.

**The other half is that a record nothing will serve comes OUT of the order before its slot**:
`TrackCachePlanner.ripen` answers with the window's unfetchable items — absent from `findForBindings` means
every copy is benched, and a backoff that outlasts the item's own projected slot is a miss rather than a wait
— and `DirectorService.thin` marks them `unavailable`, which splices, reopens any break that promised one, and
moves `remaining()` so a refill is sent. The planner judges a backoff against a slot it projects from item
durations plus `COMMITTED_LEAD_MS`, because the head of the warm window is not the record playing now and the
planner cannot see how much of what is committed is left.

**Both of those judgements apply to a CATALOGUED record only**, guarded on `trackId` exactly as
`toPlayerItems` guards the same question one window later: `findForBindings` joins from `track_sources`, so a
record the catalog has never seen is absent from it for the same reason a benched one is, and reading the two
as one fact marked 125 records of a 519-item order permanently unavailable within eight minutes of a fresh
install. `withLocalAudio` carries the same guard, because with no binding there is no id to fetch and cutting
at one was a wall the order could never get past.

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

## Where a record's audio comes from

**The player fetches every record from the app, and the app is the only thing that fetches a provider.**
`TrackAudioResolver` answers `/playout/audio/{sourceId}` for any binding that is `playable and missing_at is
null` — one URL, on this machine, whether or not the bytes are here yet — and `TrackAudioService.ensure`
behind that route reads the file, a fetch already running, or the provider, in that order.
`deadair.track_audio` says what is on disk under `TRACKS_DIR` for a BINDING (`track_sources.id`, since two
copies of one record within a provider are two files) and the bytes live in a `ContentStore` beside art and
segments.

**There is deliberately no provider link in the resolver chain**: a provider URL is fetchable only from
wherever it was minted for, so a chain that sometimes handed one to the player was deciding, silently and per
deployment, whether the URL worked at all — which is why `SpotifyShimClient` now has ONE address
(`SPOTIFY_SHIM_CONTROL_URL`, with `SPOTIFY_SHIM_URL` kept only as a fallback) and why a signed shim URL is
valid anywhere, the token covering the track id and the expiry rather than the host.

**Every fetched record is KEPT**, and the `playout.trackCache` switch that used to make that optional is gone:
its off state meant the station neither served from the cache nor filled it, which stopped being expressible
once a record may not be committed until its audio is here — a station keeping nothing would have nothing
ready and would never commit. A/B-ing a suspected bad file is done by deleting the file, since `locate` treats
a row whose file is missing as a re-fetch and repairs the row. `TRACKS_DIR` is bounded by
`playout.trackCacheMaxBytes`, which defaults to 0 meaning no cap; `TrackAudioService.sweep()` runs every
fifteen minutes off `SweepTrackCacheJob` and drops least-recently-served copies until it is under, never
touching one that is protected or in flight, and clearing rows before files so a crash leaves an orphaned file
rather than a row pointing at nothing. Four things are load-bearing: over the cap or under the floor **serves
and stores nothing**, because a truncated record airing is worse than an item the player skips; every failure
is a row with a doubling backoff rather than a throw; `attempts` counts CONSECUTIVE failures, which is why
`recordSuccess` resets it (a record fetched forty times and refused four has an intermittent upstream, not a
copy to write off); and de-duplication is an in-process map covering the LOOKUP as well as the download,
because the read that decides whether to fetch is itself a round trip. `TrackCachePlanner.ripen` warms
`CACHE_AHEAD` items past the cursor off the director's commit pass — **before** the commit rather than after
it, which is a reversal: the old ordering was argued from the items handed over this pass being past the
cursor by then, and the window now LEADS the commit lead so that a record's bytes are here several boundaries
before its slot. Two fetches per pass, and it is the only place the backoff is read (a request for bytes
something is waiting on ignores it). `CACHE_AHEAD` lives in `track.audio.service.ts` rather than in the
planner that owns the window, for the reason the analysis pace constants
(`DEFAULT_ANALYSIS_PROVIDER_PACE_MS`, `DEFAULT_ANALYSIS_LOCAL_PACE_MS`) sit in `analysis.settings.ts` rather
than in the walk that reads them: the planner imports the service, and the cycle the other way throws
`Cannot access 'CACHE_AHEAD' before initialization` under Node's ESM loader while loading fine under
vitest.

**Four consecutive failures write off the copy** — `TracksRepository.markBindingMissing` sets
`track_sources.missing_at`, which every reader already excludes on, so one statement takes the binding out of
rotation, binding selection, measurement and the running order. It is a BENCH, not a ban: `upsertTrackSource`
clears the mark on every re-sighting, so the hourly `catalog.sync` un-benches a copy the provider still lists
and it gets one more attempt. That is why the column is `missing_at` and not `playable`, which nothing clears
and which would bench a record for good over an outage. A benched copy is a separate question from an evicted
one: eviction reclaims disk from a record that is still perfectly playable, and the sweep is careful never to
take one the station is about to want.

**The track fetcher's own login is a SECOND credential, and its callback is loopback-only.** The plugin's
OAuth link answers the Web API and cannot fetch a record: an access token is minted FOR a client, the client
token the shim presents is the streaming client's, and login5 validates one against the other, so a token from
the operator's own Spotify app is refused however valid each half is (measured: 208 accesspoint
authentications, every login5 exchange refused, the same token answering the Web API throughout). The shim
therefore authorizes ITSELF once and keeps the accesspoint's credential blob — `storedLogin: false` on `GET
:3679/health` IS the diagnosis, and the symptom is a station that lists playlists perfectly while every record
502s and gets benched. The redirect is `http://127.0.0.1:<port>/login` and **cannot be moved**, because the
client id is one this project does not own and cannot register redirect URIs on; loopback with any port is the
whole of the grant. That address is reachable from the operator's browser only where the shim's port is
published on the machine they are sitting at, which is the compose stack and **not** the production container,
whose one published port is the edge's. So the browser landing on a page that cannot load is the EXPECTED
outcome on a real install, and the authorization is finished by relaying the address instead: `POST
/authorize/complete` on the shim, the three `/stream/authorization` routes on the app, and a console card that
says the page will fail before it does. Two things are load-bearing. The address is parsed by the SHIM and
nowhere else, because two readings of one callback is one of them being wrong eventually.

And **a fetcher that is DOWN and one that was never AUTHORIZED must never be drawn as one state** — both are
"no audio" and only the second is fixed by a consent screen — which is why
`FetcherAuthorizationState.reachable` exists beside `authorized`, why the attention item is raised only for a
fetcher that actually answered, and why that item is a `failure` sitting above the benched copies and failing
fetches it causes.
