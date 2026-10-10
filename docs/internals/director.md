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
graceful shutdown flushes. **A record going on air is one of those, and it has to be asked for
separately** (`DirectorService.remember`): the commit pass writes only when it prepares something,
so a boundary whose next record was still downloading left the row calling the record on air
`handed`, and a restart's `reclaimAll` then aired it again. On the live station that was every
repeat inside the one-day window for four days (2026-09-25 to 09-29), each the first record after a
restart. `station_air` says only whether the station is driving. Every writer
posts a command to `DirectorService`; nothing else may write it.

**A broadcast starts from one of three sources, and only the third chooses its copies.** A provider's
playlist and a chart are read at the moment of going on air, as `sourceTracks` says. A playlist the station
OWNS (`PutOnAirInput.stationPlaylistId`, `POST /playout/station-playlist`) names library records rather
than copies, so `stationPlaylistTracks` picks each record's copy with `bindingsFor` under the advisory
policy (the choice `addTrackToOrder` makes for one record), leaves placeholders out, and then refuses on the
same three grounds a provider's playlist does. It is recorded as an `import` whose `sourcePlaylistId`
stands with no `sourcePluginId`, which keeps the similar-records mix-in working and needs no new `source`
value. A schedule slot can name any of the three
(`schedule_slots.source_station_playlist_id`, migration 0052), and for a long pool of records the station's
own playlist is the one to name: a provider's playlist is read in full at the moment the block starts, one
plugin call per fifty records each on its own deadline, and a read that fails is a block that does not
start on its playlist.

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

**A special is a slot on DATES, and it is the one precedence the schedule has** (migration 0074).
`schedule_slots.starts_on`/`ends_on` make a row run on a date range rather than every week, `yearly`
repeats it on the same month and day (a yearly range may run past New Year and is shorter than a year),
and `days` still applies inside the range. Weekly blocks refuse to overlap rather than being resolved by
precedence, on the argument that a precedence rule is a fact only the code knows; a special WINS over
the weekly schedule for its hours anyway, and that argument does not forbid it because the timetable is
projected per date and draws the special with the weekly blocks trimmed around it. Two specials still
refuse to overlap. It needed no new state on the director's side: a special is a slot with its own id,
so the tick's one comparison changes over into it part-way through the weekly show and back to that
show when it ends. `slotOn` answers specials first and then the weekly clock, `piecesOn` is the one
answer to "where is this block on this date" that the resolver, `project` and the overlap check all
share, and `slotAt` is weekly-only, since a special on the weekly clock would air every week.

**A guest host sits in on some nights of a slot, and which nights is a pure function of the date**
(migration 0077, `director/slot.visits.ts`). `schedule_slot_hosts` holds the people on a slot besides
its host, as rows with foreign keys on `caller_hosts`' argument: a guest on fixed weekdays, or at
random with `every_n` (about one night in that many) and `cooldown_days` (the fewest days between two).
"Random" is a hash of the slot, the person and the date the night began, never a die rolled at the
changeover and written down: that would be a second stored fact about what airs, and the console could
not say who is on next Friday. The cooldown counts REAL appearances, walked forward from a fixed epoch,
and the nightly chance is raised to `1/(every_n - cooldown)` so the average gap stays what the operator
asked for. Checking the cooldown against raw rolls was tried first and starved the odds: at one in four
with a fortnight's cooldown a visitor came twice in two years. The tick puts the night's host on and
stamps the order with `slot_occurrence` (the date the night began) and, while a guest sits in,
`regular_persona_id`; the slot id alone cannot tell one night from the next when a block runs straight
through midnight into its next run, so the tick also changes over when the night moves on AND its host
differs from the last night's. Both hosts are worked out from the schedule rather than read off the
order, so an operator's own recast holds until the next night, and a recast clears the regular host,
since a person choosing the presenter has replaced the schedule's "sitting in for".

**Co-hosts present beside the host, and a visiting one is a co-host who comes at random** (the
`cohost` rows in `schedule_slot_hosts`, migration 0078). A co-host row runs every night (no days, no
odds), on fixed nights, or as a visitor with `every_n` and `cooldown_days`, rolled by the same pure
`appears` as a guest host. `coHostsFor` answers who is on a night in the slot's own order, never the
night's presenter, and at most `MAX_CO_HOSTS` (three, `MAX_CALLERS`' line for the same reason), so a
visitor who wins a full night sits it out; the service refuses a fourth every-night co-host rather than
keep one who could never air. The order carries them as `co_host_persona_ids`, an id array without a
foreign key on `putOnAir`'s rule for its host, and the tick changes over at the start of a night whose
co-hosts differ from the last night's, so a visit begins at the top of the show and ends with it. A
recast keeps the co-hosts (less whoever was made the lead) and leaves their breaks as written.

**A show that is only a brief is chosen before it starts, and that does not make the schedule an
actor** (migration 0080, `schedule/prepare.slot.job.ts`). A slot with no playlist or chart used to go
on air with an EMPTY order: `putOnAir` retracted the outgoing show's queue, the director sent a refill,
the model chose a set and the set downloaded, and the mount was silent throughout. Measured on the live
station: 2m20s at The Boneyard on 2026-10-08 and 2m50s at Glam Slam on 2026-10-09, while a chart show
the same day aired its first record inside the minute. Now the tick asks the clock which show will be
on `PREPARE_AHEAD_MS` (ten minutes) from now, and for a brief-only one it sends `schedule.prepare_slot`.
That job makes the refill's own `planRecords` call from the slot's brief, period and mood and keeps the
result in `schedule_prepared_sets`, one row per slot, keyed on the night (`slot_occurrence`'s date)
because a block running through midnight is one id on two nights. The changeover reads tonight's row and
hands it to `putOnAir` on the `ScheduledNight`, which vets it as it vets a playlist, since a dislike can
land in those ten minutes, and the ordinary refill carries on from there. Three things keep this inside
the ownership rule. **The tick still decides nothing about now**: the look ahead learns which show is
next, the changeover still resolves for the present instant, and a set prepared for a show that never
airs is a wasted refill rather than a wrong one. **Nothing prepared is a running order**: the director
is its only writer and receives the set as tracks on `putOnAir`, exactly as it receives a playlist read
at the boundary. And **everything fails open**: no set, an unreadable one, one the veto empties, or a
job that never ran each opens the show empty and refilling, as every brief-only show did before. Three
obvious fixes were refused. Holding the outgoing show's queue until the new one had records would air
a programme that has ended and break `putOnAir`'s retract-first rule. Writing the set to a station
playlist, which this file's own "if it is prepared it is a playlist" seems to ask for, would put a
machine's scratch list on the operator's playlists page with nothing to clean it up; the rule is about
what may be EDITED, and nobody edits this. And Redis was refused because it holds sessions on the
promise that losing it costs a sign-in and nothing else, and because a foreign key on the slot is what
deletes a set with its slot (`ScheduleRepository.update` deletes it on an edit, since it was chosen
against the brief the edit replaced). The tick sends every minute until the row exists, and the queue's
one worker plus the job's own "already prepared" check is what makes that cheap. A hold that outlasts
the next boundary prepares nothing, and one that lapses before it is preparing for exactly the show it
lapses into. Chart and provider-playlist slots are not prepared: their opening is known only by reading
the source, which the changeover does anyway, and a chart reads by looking up every entry.

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

**A replan or a shuffle redoes what the STATION chose, and leaves what anybody else put there where it
is.** Both used to treat every `planned` item as the station's to throw away, and on 10 October that was
read as a bug rather than a rule: a replan dropped a listener's request (whose row, already `queued`, then
lapsed three hours later as having "left the running order"), its dedication, a production (whose row is
marked aired the moment it is planted, so the episode was simply lost), a break somebody asked for, and the
record or segment the operator had added themselves. `isPinned` names those, from `StationLineupLine.pinned`
and from the markers they already carried (`requestId`, `followsRequestId`, `groupId`, a `dedication` kind),
so an order saved before the flag existed keeps them across a restart. `replacePlanned`, `followRequest` and
`shuffleRemaining` all go through `fillAround`: anything not `planned` and anything pinned keeps its POSITION,
the new or reshuffled records take the slots the station's own records leave, and whatever is left over goes
on the end. Slot for slot rather than gathering the pinned items at the front, because a request was placed
in a quiet gap and a production at its hour, and both positions mean something. A pinned talk break that now
sits between two different records is not rewritten here; the claim check drops it at hand-over, which is
that check's whole job. Undoing a replan is deliberately not built: it would need the dropped breaks kept
alive rather than retired, for a press that is rare.

**A break the player already holds has passed that check, so the record it announced stays put as well.**
`StationLineup.staysPut` is `isPinned` plus the first record after any `handed` or `airing` break
(`nextTrackAfter`, the record a "coming up" names), and it is what `fillAround`, the shuffle's tail and the
replan job's seed all read. On 10 October a break naming "No One Knows" was handed as the record before it
started; a shuffle and a request's follow-on then dropped "No One Knows" while that record played, the
break kept its place as everything handed does, and the station said "coming up" about a record it did
not play. The record is kept rather than the break retracted: a handed break is seconds from air or
already on it, a retraction throws away audio the player has fetched, and keeping the promise costs one
record its turn. The order cannot see a break's words, so it keeps the record after every held break,
not only after one that named it. A talk-over cue is the exception: it is marked `handed` when it is
attached to its record's prepared form and reaches the player only with that record, so while the record
is `planned` nothing has been promised and moving it is `forgetStranded`'s case.

**A dislike is the one edit nobody types at the desk.** Every other arm of `OrderEdit` is something an
operator did to the running order; `vetoDisliked` arrives from `DislikeVeto` when they rate something in the
CATALOG, which is the same instruction given somewhere else, and it wants the same answer and the same feed
row — so it is an edit rather than a command of its own. It carries ITEM ids rather than a rating because
deciding which lines are forbidden means asking the catalog what it now thinks of a batch of records, and the
mailbox's rule is that anything slow happens before the post. It is the second arm that reaches past `planned`,
and it handles the three states it can meet differently and deliberately: a `planned` line goes through
`remove`, so a break is marked and a beat takes its production with it; a `handed` one is marked `skipped` and
the queue retracted, for `skipTo`'s reason — `removed` is outside `committedThrough`'s head and would leave the
run in front of the player looking editable; and the record AIRING is reported back and left alone, because
cutting it is the transport's half. `DirectorConsoleService.vetoDisliked` then cuts it through
`PlayoutPusher.skipCurrent`, outside the mailbox, on the same argument the skip below makes. Why it exists at
all is in `docs/internals/programming.md` § "The station's opinion".

**Skipping to a record is the one edit allowed into the player's hands.** Every other edit is refused on
anything past `planned`, because the operator would be rearranging what a listener is about to hear, and
here that is the request. `StationLineup.skipTo` marks everything still to come in front of the record
`skipped`, which is what `markAiring` would have written had the player got there on its own. It does not
mark it `removed`, which is an operator's cut and would leave that run of the order looking editable to
`committedThrough`. Breaks and talk-over cues in front of it go too, since their words were written against
records nobody is now going to hear, and `retireSegments` writes their rows off as a removal's are. Only a
record can be the target. It is two halves in a fixed order. The director's command (`OrderEdit` `skipTo`)
moves the order and `Rundown.retract`s the player's queue, but **only when the player was holding something
it passed over**: when the target is already the next thing held, a retraction throws away a record the
player has already fetched and puts the mount on the bed while it downloads again. Then
`DirectorConsoleService.skipToOrderItem` cuts what is on air through `PlayoutPusher.skipCurrent`, outside
the mailbox, because the cut waits out a boundary and the mailbox must not. It cuts nothing when nothing is
airing, and a cut the stream refuses is logged rather than answered as a 409: the order has already moved
and been written down, so the record is next either way.

**Every cut names the item it is for.** `skipCurrent` sends its cut only after the transport guard is free
and a top-up pass has run, and that pass resolves and pushes, so seconds can pass between the ask and the
cut. A record that ends on its own inside them leaves the next one airing, and an untargeted cut takes THAT
off: the operator's Skip lands on the record after the one they saw, a skip-to can cut the very record it was
aiming for, and an overrun cut takes the new programme's first record. So each caller reads the id airing
when it was asked (the operator's Skip, `skipToOrderItem`, `vetoDisliked`, `cutOverrun`), and `skipCurrent`
cuts nothing when the pass it waited for shows that item gone, answering as though the cut had landed,
since the item is off air either way. The id also goes to the player as `X-Skip-Item`, and `radio.liq`
makes the same check where no boundary can overtake it, because Liquidsoap runs one handler at a time.

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
host of its own, and `PersonasService.setDefaultHost` says so by posting the SAME command with no binding — what
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

**A MOOD is the second exception, and it changed what "right about mood" meant.** The paragraph above
says a mood dropdown is strictly weaker than prose, and it was, while nothing knew what mood a record was
in: a mood column could only have been matched against a vocabulary nothing filled. Once a model has
judged each record (`deadair.track_lyric_labels`, with `lyrics.moods` on), "comfort" is a share every
judged record carries, and the floor can lean on it with nothing reading prose. So `station_lineup.moods`
and `schedule_slots.moods` (0066, made lists by 0084) ride beside the period, copied at a changeover and
read on every refill, and one of them reaches `SetInputs.mood`. It differs from the period in one way that
matters: it LEANS and never narrows, because a mood read off lyrics is wrong often enough that keeping a
record off the air for it would be the station acting on a guess. See `director/mood.lean.ts`. A broadcast
put on by hand can carry them through `PutOnAirInput.moods`; the sustaining hours and the console's
put-on-air form do not offer them yet.

**A slot's moods are STAGES, one to four, and a refill leans into the one its records will mostly air
in.** An evening that should open warm and close lonelier could only say one of those while a slot held
one mood. The stages split the slot into equal shares in order, and `refillMood` (`mood.stage.ts`) picks
one per batch: from the slot in force NOW, which is the only instant `minutesIntoSlot` is defined for, plus
how far ahead the batch mostly airs (`batchMidpointMs`: where it starts after the queue, plus half of it
at `NOMINAL_TRACK_MS`), and past the end is the last stage. **One stage per batch is coarse and is meant
to be**: a refill is about an hour of records, so a slot with more stages than hours airs only the stages
its refills land in, and that is written here rather than discovered. A broadcast whose slot is not the one
in force (put on by hand outside it, or still airing after a changeover moved on) leans into its first
stage, so does a single stage, and the schedule is only read when there is a choice to make. A replan
measures from behind what the player holds, since that is all of the old order its new tail follows.
**Deferred, deliberately: holding a strong record for the last spot before a changeover.** The refill
cannot know it is filling the last spot, so that needs the changeover to reserve one, which is a design
of its own.

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

**A REQUEST SHOW is asked for on the row too, and it is the one thing a listener can change about what
follows.** `rules.requestShow` (with `rules.requestFollowOn`, default 4, at most 10; see `request.show.ts`)
rides the `rules` jsonb beside `mixInSimilar`, so the running order needs no column of its own; a slot carries
it as `schedule_slots.request_show`/`request_follow_on` (0081), copied at a changeover like `breaks`. Off it, a request goes into
the first quiet gap and the catalog the station had planned plays on behind it. On it, once
`RequestDesk.place` has the request in the order it sends `director.follow_request`, and `FollowRequestJob`
finds that many records like the REQUEST (one `similarTracks` question, then the artist's neighbours for
whatever that could not fill), resolves them with the broadcast's rules and posts one `followRequest`
command. The director replaces everything still planned behind the request with them, which is
`replaceTail`'s swap with the request as its floor, retired breaks and all. Three things hold it together.
It is found before anything is dropped, on `ReplanLineupJob`'s rule, so an empty answer leaves the catalog
playing. It is seeded from the request and never from play history, on `MixInSimilarJob`'s argument. And
**a run is never split**: each record carries `followsRequestId`, and `quietGapFrom` will not land anything
in front of one, so a second request comes back `no-gap`, waits `pending`, and the `requests.tick` cron
places it straight after the run, where it gets a run of its own. That alternation is what stops a busy
night turning into a jukebox, and it is why `insertRequested`'s "after the last request" floor makes the
newest request the only one a run can follow. After the run the ordinary refill takes over again.

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
argument, and the live station measured it too short: on 2026-10-02 downloads ran past it, the rundown pushed
the same record again, and the pusher then flushed the station's own records as a stranger's queue. So
`radio.liq` now reports `resolving`, the requests it is downloading, and `heldBy` adds them to `queued`
wherever the app asks what the player holds. The grace is the fallback for a script that does not report it,
and it runs from the first reading that MISSED an item (`Rundown.missingSince`) as well as from its hand-over:
at a boundary the queue pops the next request before `on_track` moves `onAir` onto it, so one reading in between
finds it nowhere. On 2026-10-10 that reclaimed a break three minutes after its hand-over and 0.7s into its
airing, and the break writer rewrote it under the listener.
`MAX_HAND_OVERS` STAYS at 3: it covers a Liquidsoap that restarted and dropped what it held, which is not an
audio-availability fact.

**A smart shuffle programmes the tail it shuffles, and reads nothing to do it.** With `rotation.smartShuffle` on, `DirectorConsoleService.shuffleOrder` reads the songs aired inside the horizon from `play_history` and posts them on the `shuffle` command, so the edit pass stays synchronous and the director stays the only writer. `StationLineup.shuffleRemaining` then shuffles as before and splits the result: what has not aired lately in front, what has behind, each half artist-spaced by `spaceArtists`, the first seeded with the last record the player holds. Off, it is the plain Fisher-Yates it always was. The keys never reach the activity row: it records that the shuffle was smart, not a copy of the history.

**A record mixed into a playlist lands after a named line, and only ever between two records.** `MixInSimilarJob` (see `programming.md`) posts `interleaveTracks`, whose inserts name the ANCHOR each record was found from rather than a position, because the order moves while the job walks the similarity plugin. `StationLineup.interleave` drops an insert whose anchor has gone or been handed over, and otherwise puts it in the first QUIET GAP at or within two records after the anchor: after a record whose next live item is another record or the end of the order. That is not tidiness. A break's words are checked against the nearest record either side of it (`previousTrackBefore`, `nextTrackAfter`), so a record put in beside a break falsifies "that was X" or "coming up, Y" and costs the break at hand-over; a gap between two adjacent records moves no claim. It never lands beside another mixed-in record, and it never lands ahead of the head. The item carries `mixedIn: true`, on `segmentKind`'s rule for what may be copied onto an item (set at creation, never updated), and `toItems` reads it back only when it is literally `true`.

**A record a listener asked for goes in by the same rule, near the head.** `insertRequested` (from the
requests module, see `docs/internals/messaging.md`) looks for a quiet gap starting at the first planned record
past what the player holds, or past the last request already in the order when that is further on, so two
requests never sit side by side and a second waits behind the first. The item carries `requestId` on
`mixedIn`'s rule, which is how the request is recognised when it airs, and a mixed-in record will not land
beside one either. Nothing near enough is refused as `no-gap` rather than pushed down the order: the request is
held and offered again, which beats one that airs an hour after anybody remembers asking. The requests module
only ever posts a record whose audio is already local, so this never holds the commit pass behind a download.

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

**The price of that guard is that an uncatalogued record is never FETCHED either**, so an order made of
nothing else plays nothing: it goes on air, is consumed without a byte, and the mount falls through to the
bed. `DirectorConsoleService.sourceTracks` therefore refuses a playlist none of whose vetted records carries
a `trackId`, with a 422 that says the playlist is not in the library yet. That is the third refusal there,
beside an empty playlist and one the veto empties, and all three prevent the same thing: a console that
reports the station on air while it airs nothing. It refuses rather than ingesting, because the sync is the
one path into the catalog and only its `origin = 'sync'` bindings are ever benched. And it refuses only when
the catalog was actually READ, since a failed read leaves every record without a `trackId` for a reason
unrelated to the playlist. Hit on 2026-09-19 with a YouTube Music playlist its provider did not list, which
the sync, walking `listPlaylists`, never reached.

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

**A show prepared ahead has its opening fetched ahead too, because choosing early is not enough on its
own.** The gate above holds a record until its bytes are here, and `ripen` only looks at the order on
air, so a brief-only show whose records were chosen ten minutes early (see [who owns the running
order](#who-owns-the-running-order)) would still wait on its first download at the boundary.
`TrackCachePlanner.warm` is asked once the set is saved and works on `ripen`'s terms: catalogued records
only, nothing on disk, in flight or backing off, and at most `FETCH_PER_PASS`, nearest first. The cap is
`ripen`'s restraint toward a rate-limited credential, and it also keeps the show on air from queueing
behind the next one's downloads; two is enough because the gate waits on the FIRST record and the
changeover's own passes fetch the rest. It marks nothing unfetchable, since there is no order yet to take
a record out of. It does mark every record it found as wanted (`TrackAudioRepository.markWanted`), on disk
or not, because the sweep's protected set covers only the order on air and a record evicted once and
fetched again keeps the `last_served_at` of its last real serve: without the mark, an opening fetched
early could be the first thing a sweep took.

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

**That same login is also how the station reads a playlist the Web API will not hand over.** Since February
2026 the Web API returns a playlist's items only to the account that OWNS them, while `GET /me/playlists`
returns everything the account FOLLOWS: a friend's playlist, an editorial one, Discover Weekly. The shim is not
a developer app, so `GET /playlist/{id}` there answers those from the client protocol —
`/context-resolve/v1/{uri}` for the uris and one batched extended-metadata read per hundred for the titles —
and `SpotifyPlugin.getPlaylistTracks` falls back to it on a 403, remembering which playlists were refused so a
43-page walk spends one rather than 43. Measured 2026-09-16: 2142 tracks in 1.3s, 45 in 299ms. Three
consequences worth knowing before relying on it. The shim resolves a playlist WHOLE and holds it for two
minutes, because the caller that matters is the hourly `catalog.sync` walking fifty at a time and a resolve per
page would spend the session the station airs on. Every followed playlist is therefore ingested by that sync,
which is the intended answer and the reason hiding one exists (`deadair.hidden_playlists`). And **the advisory
is mostly absent on this path** — `TRACK_V4` omitted `explicit` on 2124 of those 2142 — so a `clean-only`
station draws almost nothing from a playlist read this way, since an unmarked copy is not a clean one.

And **a fetcher that is DOWN and one that was never AUTHORIZED must never be drawn as one state** — both are
"no audio" and only the second is fixed by a consent screen — which is why
`FetcherAuthorizationState.reachable` exists beside `authorized`, why the attention item is raised only for a
fetcher that actually answered, and why that item is a `failure` sitting above the benched copies and failing
fetches it causes.
