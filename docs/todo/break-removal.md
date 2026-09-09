# Deferred: removing a break has to stick

**As of:** 2026-08-11, found while listening to the station with breaks on.

**Shape 1 built 2026-08-12.** A removed break is a `removed` item in the order rather than a splice,
the walk reads it like any other segment already there, and the segment row behind it is retired
with a reason. What is left of this file is shape 2, the move case, and the two smaller things at the
bottom. The two sections below are kept as written, because the reasoning in them is why the fix is
the shape it is.

**Shape 2 is now scoped**, under "The quiet spell": a quiet counted in RECORDS on
`deadair.station_air`, decremented where play history is already written, which gates planting and
withdraws the breaks already in the tail. Three phases, the first usable on its own.

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
cursor accumulating the airtime since the last break OF THIS KIND already in the order — every other
segment counts as ordinary programme, exactly like a record — and marks a slot wherever that total
reaches `breakEveryMinutes`. That is what makes a second pass over an order it has just planted into
find every gap short and plant nothing.

`StationLineup.remove` splices the item out and leaves no trace of it
([station.lineup.ts:530](../../apps/api/src/modules/director/station.lineup.ts#L530)). So the walk
that runs a moment later sees an order with a full interval of records and no segment in it, which
is indistinguishable from an order that was never planted into, and it does the correct thing for
that order: it plants a break. The operator's delete is not being overruled, it is being forgotten.

The same argument applies to a break the operator MOVES: `move` relocates the item, the count from
the cursor comes up short at the old position and long somewhere else, and the planner fills
whatever gap that opened. **Still open**, and deliberately: a move leaves the break in the order, so
the walk is reading a true statement about where the station will talk. What it then does — filling
the interval the move opened up behind it — is arguably the correct answer to that order rather than
a forgotten edit, which is what makes it a different question from the removal.

There is a second, quieter half. A removed talk break leaves its `deadair.segments` row behind in
`planned`, and its `director.write_break` job may already be in flight or already have written a
script for two records it now sits between neither of. Nothing collects it. That is the same shape
as `BreakPlanner.abandon`, which fails the row with a reason when a placement is refused; a removal
has no equivalent.

## What it should do instead

The fix is a record of the removal that the walk can read, not a guard bolted onto the planner. Two
shapes, and the first is likelier:

1. **Built, with one correction.** **A removed break stays in the order as a past-state item.**
   `skipped` already exists as a state
   and already means "this was in the order and will not air"; `isPast` treats it as behind the
   cursor, and `placementsFor` would reset its count on reaching it exactly as it does for any other
   segment. Removing a break becomes marking it `skipped` rather than splicing it, and the interval
   picks up from there — the station goes one interval without talking and then talks again, which
   is what an operator deleting one break means. Deleting a RECORD stays a splice; the two are
   different requests and this is the one that has to leave a mark. The console has to render a
   skipped item in the tail without it looking like a fault, which is the real work.

   **The correction: `removed` is its own state, not a use of `skipped`.** This file assumed
   `skipped` would carry it, and it will not. `skipped` means the station REACHED an item and passed
   over it — a segment with no audio, a record nothing could resolve, a push the player never took —
   and an operator's cut is the opposite fact. Reusing it does the planner's job and nothing else,
   and three things downstream have to tell them apart: the console, which could otherwise only
   describe a removal as one of the ways an item goes wrong; `committedThrough`, which would be
   guessing from adjacency; and the activity feed, whose whole job is naming why the station is
   silent and which would report an operator's own edit as a fault.

   What it cost beyond the two lines in `remove`, none of which the note above predicted:

   - **`committedThrough` had to stop counting a cut as the head.** It answered one past the last
     item that was not `planned`, so a break cut in the middle of the hour became the boundary of
     the committed head and froze the entire order in front of it: no move, no insert, and nothing
     planted. It now counts every non-`planned` state except `removed`, which is the one that says
     nothing about how far the broadcast has got.
   - **The quiet half is `DirectorService.collectRemoved`.** It fails the segment row with a reason,
     `BreakPlanner.abandon`'s shape. It will not touch a `ready` row (an ident off the shelf, or a
     break whose audio exists: both are material to put back) and will not touch one whose id is
     still somewhere else in the order, because idents come from a shared library and the same row is
     legitimately at three slots in an hour.
   - **The console draws it grey and says "removed"**, next to `skipped`'s yellow, because nothing
     went wrong. The hint says why the row is still there: it stops the station planting another
     break into the same slot a minute later.
   - **`StationItemState` gained an arm**, so the `.ck` contract, the API's zod enum, the SDK type
     and the stored-row validator all moved together.
2. **A suppression the operator sets, expressed in records rather than in items** ("no breaks for the
   next hour" / "next N records"). Independent of the running order, so it survives an extend and a
   regenerate, and it is what the test that found this actually wanted. Wants a home:
   `deadair.settings` is wrong for something with an expiry, and the lineup's own
   `StationLineupRules` overrides are right for "this lineup" but not for "for a while". **Scoped
   against the tree on 2026-08-12; see "The quiet spell" below.**

They compose: (1) makes one delete honest, (2) makes a listening session possible without touching
station-wide settings. (1) is the bug fix and (2) is the feature.

## The quiet spell

Shape 2, worked out against the tree on 2026-08-12. Not built.

### What it is for

The failure mode of `rotation.breaks = false` is not that it fails to work, it is that it has no
expiry. An operator turns it off for an album and the station never says its own name again until
they remember. Every property below follows from that one: the operator's standing preference is
left untouched, and the quiet ends by itself.

### Records, not the wall clock

The line above offers both. What the audience gate rules out is the CLOCK: in `audience` mode a
station nobody is connected to is silent on purpose, so a wall-clock hour spent with no listeners
burns the whole suppression in silence and the operator comes back to a talking station. A count of
records only advances while somebody is hearing them, which is why it was chosen.

**The grain argument this once rested on has moved, and it is worth knowing which way.** Spacing was
counted in records when this was written, so records were also what everything else here was cut on.
It is now `breakEveryMinutes`, and the minutes it counts are AIRTIME — the durations of the items in
the order, never the wall clock — so the property that rules out an hour of silence is one both
units have, and the audience gate no longer decides between them. What is left is the reconciliation
this paragraph wanted to avoid: a suppression in records beside a spacing in minutes has to be
converted at the one place they meet, which is the walk that lifts the quiet. Whoever builds this
should count both in the same unit, and the planner's is the one with a setting behind it. The
console can still SAY either from the order's own durations, because saying it is presentation.

### Where it lives: `deadair.station_air`

The two homes the note rules out are ruled out for good reasons, and this is what is left. That row
holds the one fact about the BROADCAST rather than about the programming or the station's
configuration, which is exactly what a quiet spell is. One integer column beside `active`
(`breaks_quiet_records`, `0` meaning not quiet), and `StationAirRepository` grows a writer for it
while `get` returns it.

Stored rather than held in the director's memory, by the argument that made `active` a column: an
app restarted mid-quiet must not come back talking.

`deadair.settings` is also the thing a quiet spell must not touch. Writing `rotation.breaks` to
express "quiet for ten records" would silently rewrite the standing preference it exists to leave
alone.

### Where it decrements: `DirectorService.remember`

It already hangs off the rundown's confirmation that a record actually STARTED rather than off the
commit lead, and it already drops segments through `isRenderItem`. That is precisely the filter the
countdown needs, for the same reason: a break the station airs is not a record the listener is
counting. One `set breaks_quiet_records = greatest(0, breaks_quiet_records - 1)` on a path that
already writes a row per record, and it may fail as harmlessly as play history does.

### What being quiet does

Three behaviours, and only the first is obvious.

1. **`plant` returns early.** One more clause beside `if (!rules.breaks)`. Note that the interval
   itself is no longer part of that guard — `breakEveryMinutes <= 0` now only stands the station's
   own spacing down inside `slotsFor`, and leaves the operator's clock bands planting on their own
   schedule — so a quiet spell has to be checked where breaks are turned off wholesale rather than
   where the floor's interval is read, or an anchored bulletin will air through it. Cheap, and by
   itself not enough.
2. **It retires the breaks already planted in the tail.** Planting runs to the end of the order, so
   at the moment quiet is asked for there are already three or four breaks laid out across the next
   hour. Without this, "no breaks for the next ten records" is not heard until the tail runs out,
   which is the same defect already logged below against `rotation.breaks` toggled off mid-air. One
   mechanism settles both.
3. **Nothing is written.** Falls out of (2): `ripen` only offers what is still in the order.

The committed head is untouched throughout. A break already handed to the player airs, quiet or not,
for the same reason an operator cannot remove one.

**The retirement SPLICES rather than marking `removed`, and the asymmetry with an operator's cut is
the load-bearing part.** `removed` means "this slot is cut, do not refill it", and it works by
resetting the planner's count where it sits. A suppression is the opposite instruction: withdraw the
whole break structure now, and rebuild it from scratch when the quiet ends. Leave `removed` marks
across the tail and the walk counts from the last one when it lifts, so the station stays quiet for
an interval beyond what was asked and by an amount nobody can predict from the number they typed.
Splicing is safe here for the reason it was unsafe in the bug at the top of this file: nothing
replants while `plant` is gated, and when the gate opens the walk sees a clean tail. The segment rows
go through the same collection as a cut, so the shared piece is a `retireSegment(segmentId)` that
both `collectRemoved` and this call.

### What it survives

An extend, a regenerate and a restart, deliberately: it is a fact about the room rather than about
the hour of programming that happened to be loaded when it was asked for. That is what makes it not
a lineup rule.

**One open question**, and the default is to survive: a stand-down followed by a fresh `putOnAir`.
Keeping it costs an operator who wanted a clean start one confused minute; dropping it costs the
operator who stopped the station to change playlists their quiet. Both are small, and the count
expires either way.

### Surface

A command, like everything else that touches the order (`{ kind: 'quiet'; records: number }` through
`DirectorMailbox`), so it serialises against the commit pass rather than racing it. `POST
/station/quiet` and `DELETE /station/quiet` in the `.ck`, and `StationAir` gaining `quietRecords` so
the console can draw it.

On the console, a control beside Stop offering something like 3 / 10 / rest of the order, and the
on-air header reading "quiet for the next 8 records" with a cancel. A station that has silently
stopped talking and a station that is quiet on purpose look identical otherwise, which is the same
class of problem the `removed` badge fixed.

### Phases

1. **The stored fact and the gate.** Migration column, repository, mailbox command, `plant` reads it,
   `remember` decrements it. Works end to end; the quiet takes up to one interval to be heard,
   because the planted tail still airs.
2. **Retire the planted tail**, shared with `rotation.breaks` turned off mid-air, which stops being a
   documented wart in the same commit.
3. **The surface**: contract, air payload, console control and header.

Each is one commit and one sentence, and 1 is usable without 2.

## Also worth settling with it

- **`rotation.breaks` toggled off mid-air does not retire breaks already planted.** The planner
  returns early, so nothing new goes in, but the ones already in the tail still air. That is
  defensible (they are programmed, and the head is committed anyway) but it is not what an operator
  who just switched breaks off expects to hear, and it is undocumented either way. **Settled by
  phase 2 of the quiet spell**, which needs the same withdrawal and should do both from one place
  rather than growing a second one later.
- **Whether the console's delete should say what it did.** A delete that answers "removed, and the
  station will not talk again until N records from now" is the whole of this bug's user-visible
  half.
