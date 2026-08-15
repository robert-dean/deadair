# Personas: what is left after the character sheet

**Scoped 2026-08-15**, against the tree as it stood with the news bulletin in flight. Who the station
IS is built and is described in CLAUDE.md: `deadair.personas` (migration 0012), the sheet and its
diction split (`persona.sheet.ts`), the templates chain, the voice on the row, the `music` line, the
one-active partial unique index, `PersonaRepository.presenting`, the console page and editor, and the
four seeds in `persona.defaults.ts`. None of that is re-opened here.

What follows is the four things a persona cannot do yet. Two of them (§1, §2) are the raw list's
`shows should use personas` and `persona memory` scoped against real code; §3 is what those two are
for; §4 is the smallest and has no design question in it.

They are ordered by what blocks what. §1 is a schema change §2 wants to be made before it writes its
own; §3 needs both; §4 needs neither and can be taken on any afternoon.

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

**The seam is a nullable `kind` on `deadair.personas`**, and the precedence stays in the one place it
already lives:

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

## 2. Persona memory, which the short window is not

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

This is also the whole of the raw list's `have the talk shows keep a history so it can grow
organically`: a show that remembers is a persona that remembers, and building it twice would give the
station two characters with the same name.

## 3. A schedule chooses the persona

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

## 4. A rehearsal: hear a persona before putting it on air

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
  legitimate answer that the console reports as "the station is busy".
- **It must not be able to air.** Nothing about a rehearsal writes `deadair.segments`, exactly as the
  voice sample writes no row. Its own store or no store at all; a script that can be planted is a
  break, and a break is not a preview.

Whether a rehearsal is also SPOKEN is a separate call. The words are the expensive half to get right
and the cheap half to produce; speaking them costs a synthesis per click and can be added later
behind the same route.

## What this file does not cover

- **Multiple personas talking to each other** (the raw list's two-voice dialogue, and what
  `from-v1.md` records as a built feature of the previous station). That is a segment KIND with two
  voices and a script with turns, not a property of personas, and it should be scoped where the
  writers are.
- **Mood**, which is [station-moment.md](station-moment.md) and is deliberately a different axis: a
  persona is who the station is and a mood is what the hour is like. A persona that changed with the
  clock would be a schedule, which is §3.
- **A persona choosing its own music beyond the `music` line.** The line reaches `ModelSetGenerator`
  and the brief beats it, and that precedence is settled (CLAUDE.md, and
  [station-intelligence.md](station-intelligence.md) §1).
