# Deferred: lifting the repeat rules for a stretch of the day

**Written:** 2026-08-19, from wanting a "Metallica hour" on the schedule.
**State of the tree:** the mechanism is half built and has no writer. `ResolvedRules` already
resolves station defaults under a lineup's own per-field overrides, `station_lineup.rules` already
persists that bag, and `StationLineupRules` already declares every field of it. **Nothing sets it.**
`PutOnAirInput` has no `rules`, `DirectorConsoleService.putOnAir` builds a `StationLineupBinding`
without one, and `schedule_slots` has no column for it. So the overrides are a shape with no
operator surface, and the only way to change how often the station repeats itself is to change it
for the whole station in `rotation.*`.

The ask is one sentence: **an operator wants a stretch of the day where the repeat window and the
artist cooldown do not apply, and where the station picks the least-played records instead.** That is
two halves and they are not the same size. The first is wiring a bag that already exists to two
surfaces that do not carry it. The second is a change to the draw.

---

## Why the window has to be lifted at all

A Metallica hour is not blocked by anything that names Metallica. It is blocked by three rules that
each look reasonable on their own, and all three have to come off or the hour does not happen:

| rule | default | what it does to a one-artist hour |
| --- | --- | --- |
| `artistCooldownMinutes` | 40 | the second record is refused for forty minutes. This is the one that kills it outright |
| `maxPerArtist` | 2 | a generated batch of fifteen comes back holding two |
| `repeatWindowDays` | 3 | a small pool cannot come round twice, which is what an hour of one artist eventually needs |

**Three fields, not one switch**, and that is the first thing to write down: an "ignore the repeat
window" checkbox alone changes nothing an operator would notice, because the cooldown is what is
actually refusing the records.

## What is already in the tree, and what it costs to reach

**`resolveRules` is the whole evaluation path and it needs no change.**
[rotation.rules.ts](../../apps/api/src/modules/director/rotation.rules.ts) resolves tightest-last:
the mode's baseline (`station` for a `rotation`, `NO_RULES` for a `setlist` or a `feature`), then the
lineup's own overrides field by field. An overrule is an override, so this is already the code that
applies it. Nothing new judges anything, which keeps `docs/decisions/on-air-ownership.md` intact:
the schedule stays a document, a resolver and a timer that posts commands.

**The row already holds it.** `station.lineup.repository.ts` selects and writes `rules` as jsonb, and
`StationLineup.rules` reads it back. The column has been round-tripping an empty bag since it was
added.

**The schedule slot carries everything except this.** `deadair.schedule_slots` (migration 0017) has
`label`, `starts_at_minutes`, `ends_at_minutes`, `days`, `source_plugin_id`, `source_playlist_id`,
`persona_id`, `brief`, `mode` and `on_end`, and `ScheduleTickJob.changeOver` copies each of them into
`putOnAir`. A `rules` bag would ride exactly where `brief` rides and for the identical reason the
brief is on the row rather than in a job payload: `on_end = 'extend'` keeps asking for more, so
anything held only by the batch that started the block is gone within the hour with nothing saying
so.

~~**`mode` is unreachable from the console.** `bodyOf` in `schedule.page.tsx` round-trips it and
`SlotEditor` has no field for it, and the on-air panel has none either, so every broadcast this
station has ever run is a `rotation`.~~ **Wrong, corrected 2026-09-02.** `SlotEditor` has offered
both `mode` and `onEnd` all along. The claim came from a search that found nothing, and the reason
it found nothing is that `slot.editor.tsx` carries NUL bytes as a value delimiter (`pluginId\0id`),
which makes git and grep treat the file as binary and skip it without saying so. The on-air panel
half was true and is fixed; both are now pinned by `apps/web/tests/components/schedule/slot.editor.test.tsx`.

## Decisions

**The overrule is the existing per-field bag, on the slot and on `putOnAir`. Not a new mechanism.**
One `rules` jsonb column on `schedule_slots` mirroring `station_lineup.rules`, same shape, same
resolver, copied onto the binding at changeover. Not a set of per-field columns: the shape is defined
in one place today and columns would define it in two, and the next field added to `ResolvedRules`
would then need a migration to reach the schedule.

**`mode: 'feature'` is NOT the answer, even though it looks like one.** A `feature` baselines to
`NO_RULES`, which does turn all three rules off — and also turns off `breaks`, `welcome`,
`autoExtend` and `crossfade`. An operator who asked for a Metallica hour and got one with a silent
DJ, no greeting for anyone tuning in, and a running order that stops when the batch does has been
answered with something they did not ask for. The overrides are per field precisely so this does not
have to be all-or-nothing, and `resolveRules`' own comment already makes the argument in the other
direction ("an operator who wants a cooldown inside a long setlist can have one").

**A lift never reaches an instruction.** `rejectDisliked` stays, and so does anything
[never-play-rules.md](never-play-rules.md) lands: those are absolute by construction and live outside
`ResolvedRules` for that reason, so this change literally cannot reach them. Say it out loud in the
console copy anyway, because "ignore the repeat rules" reads broader than it is.

**Slot-scoped, not artist-scoped.** There is no "always bypass the window for Metallica". A rule
about a THING is the ratings mechanism and a rule about a KIND of thing is
[never-play-rules.md](never-play-rules.md); this is a rule about a STRETCH OF THE DAY, which is the
scope the schedule already owns. An artist-scoped exception would be a fourth authority over what may
air, and it would be invisible on the grid.

**The manual path gets it too.** `PutOnAirInput.rules`, so a spontaneous Metallica hour is possible
without editing the schedule. Without it, the only way to lift a rule is to add a block to the
timetable and wait for the boundary, which is not what an operator pressing "on air" means.

**Least-played is a BIAS, never a filter and never a strict ordering.** This is
[station-intelligence.md](station-intelligence.md) §5's own rule about the stale draw, and it holds
harder here: `order by plays asc limit n` would make the same hour play the same records in the same
sequence every week, which is the failure the random draw exists to avoid. It composes with the
existing like-doubling in `weightOf` rather than replacing it.

**The count is keyed on `song_key`, not `track_id`.** `play_history` carries both, and `song_key` is
the identity every rotation rule already reads — see the warning at the top of `rotation.keys.ts`. A
count grouped by `track_id` would split one work across two catalog rows and report both as cold.
`play_history_song_idx (station_key, song_key, aired_at desc)` already supports the grouped count.

**A count from `play_history` is a 120-day count and must be described as one.** `prune` deletes
older rows (`RETENTION_DAYS = 120`), so a record played heavily last year and a record never played
at all are the same number here. That is fine for a bias and would be wrong for anything that
refused, which is a second reason it is not a filter.

## The draw is the part that is not free

`CandidatesRepository.sample` is `order by random()` over the playable, unmerged, undisliked set,
limited to `count * SAMPLE_MULTIPLIER` and capped at `SAMPLE_CEILING`, and the picking on top of it
weights by rating alone. Nothing anywhere reads a play count. So the bias is two places, exactly like
`tagsFor` in [never-play-rules.md](never-play-rules.md):

- **In SQL**, a left-joined aggregate so the drawn rows carry their play count. A `left join` with
  `coalesce(count, 0)`, so never-played sorts cold rather than dropping out of the join.
- **In TypeScript**, in `weightOf`, where the rating weight already lives and is table-tested.

The honest limitation to record now rather than discover later: **the sample is a random subset, so a
weight applied after it can only choose between what was drawn.** On a library of thousands with a
sample of a couple of hundred, the genuinely coldest records may not be in the pool at all. That is
acceptable because the hour this is for is already narrowed — by a playlist source, or by a brief the
model programmes against — so the pool is small. If it ever needs to be true of the whole library,
the fix is ordering the SQL by a randomised function of the count rather than raising the ceiling,
and that is a different change with its own test.

**What stops an hour repeating a record inside its own batch is not the window**, and this is worth
knowing before assuming the lift breaks something: `SetGeneratorChain` dedupes by `songKey` across
the batch and against `songKeysOf` the remaining order. So lifting the window does not produce a
batch holding one record twice. What it produces is a record coming round again a few batches later,
which is the entire point and is what the bias then shapes.

## The phases

1. **`PutOnAirInput.rules` through to the binding.** The `.ck` contract, the SDK it generates, and
   `DirectorConsoleService.putOnAir` copying it onto `StationLineupBinding`. `resolveRules` already
   applies it and the row already stores it, so this makes an overrule expressible with no new
   evaluation anywhere. No console surface yet. *Commit: a broadcast can be told which rules to lift.*
2. **`schedule_slots.rules`**, the migration, the repository, the contract and `changeOver` copying
   it into `putOnAir` beside `brief`. Nothing sets it from the console yet, so the schedule behaves
   exactly as it does today. *Commit: a slot carries its own rules.*
3. ~~**The two operator surfaces.**~~ **BUILT 2026-09-02**, in the narrower form phase 8 of the
   [comparable-stations plan](comparable-stations.md) actually needed: `mode` and `onEnd` are now
   settable from both `SlotEditor` and the on-air panel, each with copy saying the lift does not
   reach a dislike. The "Rules for this block" tri-state section — the `artistCooldownMinutes`,
   `maxPerArtist` and `repeatWindowDays` overrides phases 1 and 2 wire up — is still unbuilt, and
   still blocked on those phases landing a `rules` bag on `PutOnAirInput` and `schedule_slots`.
4. **`CandidateTrack.plays`**, the left-joined aggregate in `sample`, and
   `scripts/leastplayed.smoke.ts` following `rating.smoke.ts` and `advisory.smoke.ts`, because the
   interesting half is SQL. Carried and unread. *Commit: a candidate knows how often it has aired.*
5. **`weightOf` reads it**, composing with the rating weight, table-tested like everything else in
   `rotation.rules.ts`. This is where a Metallica hour starts sounding like one rather than like a
   shuffle of four songs. *Commit: the draw favours what the station has played least.*

Phases 1 to 3 stand alone and are worth having without 4 and 5: an operator who wants a themed hour
gets one, it just picks at random within the theme. Phases 4 and 5 stand alone in the other
direction — a colder draw is an improvement to every rotation, not only to a lifted one.

## The one open question

**Whether the bias is always on or rides the lift.** Always on is simpler and improves the ordinary
rotation. Riding the lift is more conservative: with a three-day window in force the draw is already
varied, and a permanent coldness bias makes the station work through its library in something close
to a fixed order until everything warms up, which is a taste change nobody asked for. The
recommendation is **riding the lift** — one setting, two halves, described to the operator as "play
what has been played least" — with the always-on version reachable later by moving one condition, and
never the reverse.

## Related

- [never-play-rules.md](never-play-rules.md) for the scoping vocabulary (season, daypart, lineup
  mode, schedule slot) and for the bias-versus-veto split this file inherits.
- [station-intelligence.md](station-intelligence.md) §5 for the freshness bubble, which is the same
  argument about a stale draw and is deliberately a different mechanism.
- [director-and-lineups.md](director-and-lineups.md) for the daypart schedule this hangs off, built
  2026-08-19.
- `docs/decisions/on-air-ownership.md` for why the schedule may never evaluate a rule itself.
