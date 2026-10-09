---
'@deadair/api': minor
---

The schedule can hold special shows on dates: Halloween night, the week before Christmas, a one-off evening. A slot with a first and last date (`startsOn`, `endsOn`) is a special, and `yearly` repeats it on the same month and day every year, including a range that runs past New Year. On its dates a special takes over from the weekly schedule for its hours, and the weekly show resumes when it ends. The timetable draws the special with the weekly blocks trimmed around it. Two specials still may not overlap each other.
