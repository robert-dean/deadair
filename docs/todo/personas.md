# Personas: what is left after the character sheet

**Scoped 2026-08-15**, against the tree as it stood with the news bulletin in flight. Who the station
IS is built and is described in `docs/internals/personas.md`: `deadair.personas` (migration 0012), the sheet and its
diction split (`persona.sheet.ts`), the templates chain, the voice on the row, the
one-active partial unique index, `PersonaRepository.presenting`, the console page and editor, and the
four seeds in `persona.defaults.ts`. None of that is re-opened here.

What follows is the five things a persona cannot do yet. Two of them (§1, §2) are the raw list's
`shows should use personas` and `persona memory` scoped against real code; §3 is what those two are
for; §4 is the smallest and has no design question in it. §5 was added a day later and is what §3
leaves unsaid.

They are ordered by what blocks what. §1 is a schema change §2 wants to be made before it writes its
own; §3 needs both; §4 needs neither and can be taken on any afternoon. §5 needs §3 to exist and
nothing else.

**That ordering was wrong about §3, which landed first (2026-08-19) and needed neither §1 nor §2.**
The blocker it was waiting on was the daypart schedule rather than anything about personas: a slot
carries a `persona_id` and the changeover copies it onto the running order, which is all this ever
was. §5 is therefore unblocked and is now the one to take, and its rule is already written down in
`docs/decisions/on-air-ownership.md` — a clock-fired changeover defers its spoken half to the next
track boundary, where an operator's airs at once.

## 1. One station, one persona, and the newsreader is the case that broke it

`PersonaRepository.presenting(lineupPersonaId)` answers ONE row: this broadcast's host, then the
station's active one, then nothing. Every writer reads that same row, which was exactly right while
the only thing the station said was a talk break, and stopped being right the day it read the news.

Today, with a persona on air, a bulletin is written from that persona's sheet
([model.news.break.writer.ts:104](../../apps/api/src/modules/director/model.news.break.writer.ts:104))
and spoken in that persona's voice
([write.break.job.ts:204](../../apps/api/src/modules/director/write.break.job.ts:204), `segment.voice
?? persona?.voice`). So a pirate captain reads the headlines in the pirate's voice, and the station
has no way to say whether that is the joke or the bug. Both answers are legitimate — a character
station wants its host reading everything, a straight station wants a newsreader — and the shape that
cannot express either is the current one.

**One thing this entry assumed is no longer true, and it makes the work smaller.** It was written
when a station had one usable voice, so "the pirate reads the headlines in the pirate's voice" was
half a hypothetical: `segments.voice` could name a newsreader and nothing would sound different.
Since 2026-08-21 both bundled speech plugins ship a map covering every seeded persona plus a
**`newsreader` slot**, put there for exactly this entry, and each persona names its own voice. So the
question this section asks is now a real one with an audible answer, the row to point at already
exists on both engines, and none of the work below is blocked on a voice to reach for — what is
missing is only the `kind` column and the precedence, which is what this section was always about.
See `docs/internals/render.md` and `docs/internals/personas.md`.

**The seam is a `kind` on `deadair.personas`**, and the precedence stays in the one place it already
lives. **The column landed on 2026-08-25 with the caller work, and it is NOT NULL with a default of
`host`** — which is a correction to what follows rather than a detail. This entry sketches it nullable
with the active index becoming `(station_key, kind)` "with nulls distinct", and nulls distinct is
Postgres's DEFAULT for a unique index: two rows with a null kind would not conflict, so the station
could have two active hosts. With a positive value that hole does not exist and the index below is
safe to write when the newsreader arrives. Adding `newsreader` is one entry in the check constraint:

```
presenting(kind, lineupPersonaId)
  -> the persona scoped to this kind, if the station has written one
  -> this broadcast's host
  -> the station's active persona
  -> nothing
```

Four things are load-bearing, and each one is a way this goes wrong if it is built casually.

**The index has to move with the column.** `personas_one_active_idx` is `unique (station_key) where
active`, so a second active persona of any kind is rejected by the database. A kind-scoped persona is
active at the same time as the host by definition, so the index becomes `(station_key, kind)` with
nulls distinct — and `setActive` clears within a kind rather than across the station. Getting this
wrong does not produce a bad break, it produces a persona an operator cannot switch on.

**The floor has to resolve the same persona as the model**, or a declined bulletin comes out in the
host's phrasings and the newsreader's voice, which is worse than either alone. That means
`resolveTemplates` and the voice stamp both read the kind-scoped answer, not just
`breakPrompt`. Note that `NewsBreakWriter` deliberately does NOT chain into a persona's templates
today, for `WelcomeWriter`'s reason
([news.break.writer.ts:39](../../apps/api/src/modules/director/news.break.writer.ts:39)); that
decision is worth re-reading once there is a newsreader to chain into, and may well survive.

**A persona per kind is not a persona per SEGMENT.** `segments.persona_id` already records which
character a break was written as, and it stays the record rather than becoming the control: the
station decides who speaks from the kind, and the row remembers what it decided.

**`station_lineup.persona_id` is unaffected.** A show names its host, and a host is not a newsreader;
a briefed broadcast that names a persona overrides the host arm of the precedence and nothing else.

## 2. Persona memory, which the short window is not — BUILT

**Built 2026-08-22**, and it cost what this section predicted plus one thing it did not. The
prerequisite landed first as its own commit (`script_history.persona_key`, stamped on every write
ATTEMPT rather than only the winner, so a character whose model breaks are all being refused is
visible rather than hidden behind the floor). `deadair.persona_notes` is the store, shaped after
`deadair.pronunciations`; `deadair.persona_note_passes` is the watermark, which is where this parts
company with `fact_extractions` — documents arrive in no order and each needs its own mark, scripts
are a time-ordered stream and one timestamp covers them.

The thing it did not predict is a precision bug the smoke script caught: Luxon is
millisecond-resolution and Postgres is microsecond, so a watermark taken from a row's own
`created_at` compares as EARLIER than that row and re-reads it on every pass, forever. Both ends
carry the column's own text now. Anything else that stores "how far did I get" against a
`timestamptz` has the same trap waiting.

What is left is the OPINION. The pass reads every written break by a character, and nothing in the
station says whether any of them were any good — so a note distilled from a break the operator
disliked is the character being taught to repeat what did not land. The one clause is named in a
comment on `ScriptHistoryRepository.writtenBy`; [break-ratings.md](break-ratings.md) is the other end.

The rest of this section is kept as the record of what was decided and why.

There is already an avoid-list: `WriteBreakJob` hands the writer the last six scripts of the same
kind ([write.break.job.ts:172](../../apps/api/src/modules/director/write.break.job.ts:172),
`RECENT_WINDOW = 6`), and the prompt tells the model not to reuse their opening or their shape
([break.prompt.ts:228](../../apps/api/src/modules/director/break.prompt.ts:228)). That is the cheap
seed `dj-voice.md` correction 3 asked for, and `segment.repository.ts:337` already says where it
stops being enough.

It stops in three specific places, all of which are the same missing fact:

- **It is keyed by KIND and not by character.** A station that switches from the warm daytime host to
  the late-night one hands the new character the old one's last six lines and tells it not to sound
  like them, which is an instruction about the wrong person.
- **Six is a rotation's length, not a memory.** "Use a signature phrase, but not every time" is an
  instruction about the last hour; "you mentioned this record last week" is an instruction about the
  last week, and no window of raw scripts is the right shape for it because the useful form is a
  SUMMARY rather than transcripts.
- **The station's own long record cannot answer it either.** `script_history` is the append-only row
  per write attempt and it is denormalised precisely so it outlives its segment — and it has no
  persona column. `segments.persona_id` cannot cover for that, because the whole point of the
  denormalisation is that the segment may be gone. **So a `persona_key` on `script_history` is the
  prerequisite**, and it is a prerequisite whether or not the rest of this section is built: without
  it, "what has this character said" is not a question the station can ask of its own history at all.

Beyond that column the shape is a `persona_notes` table (or a `notes` jsonb on the persona row, which
is worse for the reason a mood was worse: it is a list an operator and the station both append to)
holding short summarized lines per persona, written periodically from `script_history` rather than on
every break, read into the prompt beside the sheet and capped exactly like `PERSONA_SHEET_LIMITS`
caps everything else. Two questions are genuinely open and should be decided before it is built:
whether a note is a FACT the character stated ("said the drummer plays left-handed") or a growth in
the character itself, and whether the operator can see and edit them — the first is a station being
consistent, the second is a station writing its own sheet, and the second is a much bigger idea.

**Both were decided on 2026-08-22, and the answer to the first is BOTH, split by kind.** A `said` note
records something the character actually put on air and carries the script as its evidence, so it goes
active unattended; a `trait` note is an inference about who the character is becoming and arrives as
`suggested`, which answers the second question in the only way that keeps the sheet the operator's own.
That is `deadair.pronunciations`' shape exactly — a confident derivation goes live, an uncertain one
proposes, and `rejected` is a state rather than a deletion so the next pass cannot re-propose it
forever. Notes come from the station's own history and nothing else; a searched source is a different
threat posture and is not this.

**The one thing it needs that does not exist is an opinion.** A note distilled from a break the
operator disliked is the character reinforcing what did not land, and nothing anywhere records that a
break was bad — the automatic signal is `characterFault`, which is the station's own rubric. So the
distil selection is written with the predicate that skips a disliked break named in a comment, and
[break-ratings.md](break-ratings.md) is the table that makes it a clause.

This is also the whole of the raw list's `have the talk shows keep a history so it can grow
organically`: a show that remembers is a persona that remembers, and building it twice would give the
station two characters with the same name.

## 3. A schedule chooses the persona — BUILT

**Built 2026-08-19**, with the daypart schedule, and it cost exactly what this entry predicted:
`deadair.schedule_slots.persona_id` rides the slot, the changeover copies it onto the binding, and
`presenting` reads it as it already did. Nothing in the director, the writers or the console changed.
"9-12 is the warm host, midnight is the late-night one" is now a row an operator writes at
`/schedule`.

The one thing the entry did not anticipate is which way the fallback points at the SLOT level.
`schedule_slots.persona_id` is `on delete set null` like the lineup's, so deleting a persona leaves
the slot standing and drops it back to the station's own host — and a slot naming a persona that has
since gone is voided when the schedule is RESOLVED rather than refused when it is saved, on the same
argument `presenting` already makes. Refusing to broadcast over a question about the DJ is worse than
falling back.

What follows is the entry as it stood.

Nothing here is new work on personas — it is the daypart schedule in
[director-and-lineups.md](director-and-lineups.md) reaching a column that already exists.
`station_lineup.persona_id` is on the row, `presenting` already prefers it, and migration 0013 already
argues the `on delete set null` fallback. So "9-12 is the warm host, midnight is the late-night one"
is a scheduler writing one uuid when it builds a running order, and nothing in the director,
the writers or the console changes.

Worth recording so it is not designed twice: the persona is chosen when the order is BUILT, not read
per break, for the same reason the brief rides the row — a character held in a refill's payload would
last one batch. A daypart boundary that should change the host mid-broadcast is therefore a new
running order, which is what a schedule produces anyway.

## 4. A rehearsal: hear a persona before putting it on air — BUILT

**Built 2026-08-16** (`ad36004`), as `POST /personas/{id}/rehearse` and
`PersonaRehearsalService`, against fabricated neighbours and with `recent: []` so a reading is
repeatable. What follows is the design as it stood, and it is kept for the first constraint below,
which is only HALF honoured.

**The priority half is not done.** The tier it asks for now exists — `gate.priority.ts`, added the
same day, where `preview` queues behind everything the station does for itself and is preempted out
of the model when the station wants it back. The rehearsal does not use it. It calls
`BreakWriterRegistry.write`, which reaches `ModelTalkBreakWriter`, which passes its own
`LlmGateOptions` and no priority, so a rehearsal contends as `station`: exactly the "must not
preempt a refill or a real break" this section was written to prevent. The fix is a `priority` on
`BreakWriteRequest`, defaulted to `station` and threaded to `converse` by the three model bindings,
which is the only route by which a writer could ever know it is being auditioned rather than aired.

An operator can already audition a VOICE — `GET /voices/{voiceId}/sample` renders a fixed line and
the console plays the blob — but not a persona. What a sheet actually produces is unknowable until it
airs, so writing one is a matter of switching characters and waiting for a break.

The seam is a `POST /personas/{id}/rehearse` that builds a `BreakRequest` against fabricated
neighbours (or the current ones, read-only) and runs the writer registry, answering with the
ATTEMPTS the registry already reports — so an operator sees the model's line, the decline, and the
floor's line underneath it, which is the same triple the activity feed reports after the fact. That
makes `dictionMarkers` tunable in seconds instead of over an evening.

Two constraints, both of which are why this is a considered piece of work rather than a button:

- **It takes the one model slot.** `LlmGate` serializes, and a rehearsal must not preempt a refill or
  a real break. It gets the background job's treatment — a bounded `maxWaitMs`, and giving up is a
  legitimate answer that the console reports as "the station is busy". *(Now expressible as
  `priority: 'preview'`, and see the note at the top: it is not yet passed.)*
- **It must not be able to air.** Nothing about a rehearsal writes `deadair.segments`, exactly as the
  voice sample writes no row. Its own store or no store at all; a script that can be planted is a
  break, and a break is not a preview.

Whether a rehearsal is also SPOKEN is a separate call. The words are the expensive half to get right
and the cheap half to produce; speaking them costs a synthesis per click and can be added later
behind the same route. That call is cheaper than it was: `SpeechGate` now serializes the engine and
takes the same `preview` tier, so a spoken rehearsal is a `maxWaitMs` and a priority rather than a
new question about what an operator clicking twice does to a render in flight.

## 5. The changeover: a schedule swaps the host and the station says nothing

**Scoped 2026-08-16**, from reading §3 back. §3 answers who is presenting after a daypart boundary
and stops there, which leaves the boundary itself as a hard cut: the warm host is talking over one
record and the late-night one is talking over the next, with no line between them saying so. Every
other thing the station does about a change in its own state has a sentence attached — a listener
arriving gets `WELCOME_KIND`, a silence cause changing gets a `station_events` row — and the one
moment a LISTENER can actually hear has none.

The shape is one break, written and spoken by the INCOMING persona, naming the outgoing one. Not two,
and that is a constraint rather than a preference: `segments.voice` is one id and a segment is one
render, so a sign-off answered by a greeting is the two-voice exchange this file already excludes,
and it would want a `kind` with turns rather than a persona feature. One break in the new host's
voice is the whole of what a schedule can say without that.

Three things make it real work rather than a fifth writer.

**The old order is retracted before the new one exists.** A changeover is a new running order (§3),
which is `putOnAir`, and `putOnAir` opens by calling `rundown.retract()` — so anything the OUTGOING
persona was to say has to have already aired, not merely be committed, or it goes out with the
programme it belonged to. That is why the incoming host carries the line: a break rendered under the
new order is on the near side of the retraction and needs no ordering argument at all. A genuine
sign-off would need the schedule to write, render and WAIT for a segment on an order it is about to
throw away, which is a lot of machinery for the less interesting half of the moment.

**It is `next`, never `interrupt`.** A daypart boundary is not urgent and the changeover policy in
[director-and-lineups.md](director-and-lineups.md) already names the moment: finish the track, then
swap. So this is `prepareRequested`'s rendered-before-injected path with the urgency that lands on a
record boundary, and the audio exists before the slot does — which is the same guarantee that keeps
a welcome from arriving as silence.

**The floor has no phrasing for it.** `rotation.breakTemplates` says nothing about a host changing,
and a persona's own `templates` are that character's ordinary breaks. A changeover template needs to
name the outgoing host, so `break.templates.ts` gains a value the way `{{next.album}}` will —
`{{previous.host}}`, resolving to the retiring persona's `djName` — and the seeds gain one phrasing
each. Without that a model-less station gets a silent changeover, which is the same station it has
today and is an acceptable first cut, but it is the half that decides whether this is a character
feature or a model feature.

Two decisions, neither settled:

- **Whether the same persona across a boundary says anything.** It should not: a schedule that swaps
  only the source is a change in the music and the host has no news to report. So the request is
  gated on `presenting` actually differing, which means the scheduler compares two persona ids it
  already holds and usually posts nothing.
- **Whether a changeover is also a `station_events` row.** Leaning yes and independent of the
  spoken half — "why did the station change character at 9" is exactly the question the activity
  feed exists to answer, and it is one `ActivityRecorder` call whether or not anybody is listening.

## What this file does not cover

- **Multiple personas talking to each other — ANSWERED (2026-08-25), and the answer was not a
  persona feature.** It is a PRODUCTION: one turn per segment, one voice each, and the block enters
  the running order whole. That is what this entry meant by "a segment kind with two voices and a
  script with turns", and the reason it could not be one segment is unchanged — `segments.voice` is
  one id and a segment is one render.

  What personas had to lend it is one column. `personas.kind` is `host` or `caller`, a caller can
  never be active (the database refuses it), and everything else a caller needs — the sheet, the
  diction check, the voice slot, `persona_notes`, `persona_stories` — it already had. See
  [produced-episodes.md](produced-episodes.md) for the six things that were decided in the building.
- **Mood**, which is [station-moment.md](station-moment.md) and is deliberately a different axis: a
  persona is who the station is and a mood is what the hour is like. A persona that changed with the
  clock would be a schedule, which is §3.
- **A persona choosing its own music at all — RESOLVED, in the other direction (2026-08-21).** This
  entry read "a persona choosing its own music beyond the `music` line", and the line itself is now
  gone. It was a FOURTH way to steer the programming beside the three keyed to the clock
  (`station_lineup.brief`, `schedule_slots.brief`, `schedule.sustainingBrief`), and two prose
  descriptions reaching one local model made it split the difference — so it had to be withheld from
  any briefed refill, which was a structural rule costing a page of explanation in three files.
  Deleting the field deleted the rule, and `SetInputs.persona` went with it: the record chooser no
  longer learns who is presenting. **A persona is a voice.** What an hour plays is the brief, plus
  the one structured half a brief can have — `era_from`/`era_to`, which is what lets a decade reach
  the deterministic draw as well as the model. See `docs/internals/personas.md` and the period rule in `docs/internals/director.md`.
