---
'@deadair/api': minor
'@deadair/web': patch
'@deadair/sdk': minor
---

A schedule slot's mood can now be up to four stages the slot moves through in order: an evening can open leaning toward comfort and close leaning toward loneliness. Each refill leans into the stage its records will mostly air in, splitting the slot into equal shares; one stage behaves exactly as the single mood did. **Breaking for API callers:** `mood` on `ScheduleSlot`, `ScheduleSlotInput` and `PutOnAirInput` is replaced by `moods`, a list; existing slots and running orders are carried over as one-stage lists.
