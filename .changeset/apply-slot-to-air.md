---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

A block you edit while it is on air can now change the show you are listening to. Open it on the timetable and press **Save and apply now**: the show carries on rather than starting again, its name, brief, period, moods, rules and host change in place, and when the change affects which records are chosen, the records still to come are chosen again while the ones already planned keep playing, so the station never goes quiet for it. A new source, mode, ending or set of co-hosts still waits for the next time the block comes round, and the console says so. Plain **Save** works as before and changes nothing on air. The same thing is `POST /schedule/{id}/apply` in the API and `apply_schedule_slot_to_air` for a connected model.
