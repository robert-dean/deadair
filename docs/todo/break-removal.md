# Deferred: removing a break has to stick

**As of:** 2026-08-11, found while listening to the station with breaks on.

## What happens

Deleting a talk break from the running order does not stay deleted. The break comes back a boundary
or two later, between the same two records, and deleting it again loses the same race. The only way
to get a stretch of uninterrupted records today is to turn breaks off wholesale —
`rotation.breaks = false` in `deadair.settings` — which is the setting working exactly as designed
and is nonetheless the wrong tool for "not this one".

## Why

`BreakPlanner.plant` runs on the director's commit pass, which runs on every track boundary. Its
idempotence is positional and nothing else: `placementsFor` in
[break.planner.ts](../../apps/api/src/modules/director/break.planner.ts) walks forward from the
cursor counting records since the last segment ALREADY in the order, and marks a slot wherever the
count reaches `breakEveryItems`. That is what makes a second pass over an order it has just planted
into find every gap short and plant nothing.

`StationLineup.remove` splices the item out and leaves no trace of it
([station.lineup.ts:530](../../apps/api/src/modules/director/station.lineup.ts:530)). So the walk
that runs a moment later sees an order with a full interval of records and no segment in it, which
is indistinguishable from an order that was never planted into, and it does the correct thing for
that order: it plants a break. The operator's delete is not being overruled, it is being forgotten.

The same argument applies to a break the operator MOVES: `move` relocates the item, the count from
the cursor comes up short at the old position and long somewhere else, and the planner fills
whatever gap that opened.

There is a second, quieter half. A removed talk break leaves its `deadair.segments` row behind in
`planned`, and its `director.write_break` job may already be in flight or already have written a
script for two records it now sits between neither of. Nothing collects it. That is the same shape
as `BreakPlanner.abandon`, which fails the row with a reason when a placement is refused; a removal
has no equivalent.

## What it should do instead

The fix is a record of the removal that the walk can read, not a guard bolted onto the planner. Two
shapes, and the first is likelier:

1. **A removed break stays in the order as a past-state item.** `skipped` already exists as a state
   and already means "this was in the order and will not air"; `isPast` treats it as behind the
   cursor, and `placementsFor` would reset its count on reaching it exactly as it does for any other
   segment. Removing a break becomes marking it `skipped` rather than splicing it, and the interval
   picks up from there — the station goes one interval without talking and then talks again, which
   is what an operator deleting one break means. Deleting a RECORD stays a splice; the two are
   different requests and this is the one that has to leave a mark. The console has to render a
   skipped item in the tail without it looking like a fault, which is the real work.
2. **A suppression the operator sets, expressed in records rather than in items** ("no breaks for the
   next hour" / "next N records"). Independent of the running order, so it survives an extend and a
   regenerate, and it is what the test that found this actually wanted. Wants a home:
   `deadair.settings` is wrong for something with an expiry, and the lineup's own
   `StationLineupRules` overrides are right for "this lineup" but not for "for a while".

They compose: (1) makes one delete honest, (2) makes a listening session possible without touching
station-wide settings. (1) is the bug fix and (2) is the feature.

## Also worth settling with it

- **`rotation.breaks` toggled off mid-air does not retire breaks already planted.** The planner
  returns early, so nothing new goes in, but the ones already in the tail still air. That is
  defensible (they are programmed, and the head is committed anyway) but it is not what an operator
  who just switched breaks off expects to hear, and it is undocumented either way.
- **Whether the console's delete should say what it did.** A delete that answers "removed, and the
  station will not talk again until N records from now" is the whole of this bug's user-visible
  half.
