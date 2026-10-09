---
'@deadair/api': minor
'@deadair/desktop': patch
---

The schedule can hold special shows on dates: Halloween night, the week before Christmas, a one-off evening. A slot with a first and last date (`startsOn`, `endsOn`) is a special, and `yearly` repeats it on the same month and day every year, including a range that runs past New Year. On its dates a special takes over from the weekly schedule for its hours, and the weekly show resumes when it ends. Two specials still may not overlap each other.

In the console, Programme has a Specials tab listing every special (on today first, then the soonest, then the ones that are over) with New special to add one; the slot editor takes a date range and a "Repeats every year" switch for a special. The timetable draws a special on its dates, named as one, with the weekly blocks trimmed around it, and refuses to drag one to another day. Dragging a block on the timetable no longer clears its mood, and paging the timetable to another week works again (it answered Bad Request).

The desktop app's timetable says a special's dates instead of its days, and editing any slot there no longer clears its mood or a special's dates.
