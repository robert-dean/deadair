---
'@deadair/api': minor
'@deadair/sdk': minor
---

**A special can come round by a rule instead of on dates.** `recurrence` on a schedule slot takes the same rules an occasion does (a fixed date, the nth weekday of a month, days from Easter, a date in the Hebrew or Islamic calendar, or a list), runs the show on each day the rule falls on the station's calendar, and answers `nextDate`. Two specials are refused if they would ever be on at once in the next forty years, and the refusal says when. A client that does not know about rules cannot wipe one by saving the slot, since a rewrite naming neither dates nor a rule keeps it.
