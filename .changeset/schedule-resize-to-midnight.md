---
'@deadair/web': patch
---

Dragging the lower edge of a block on the schedule's timetable to the bottom of the column now ends the show at midnight. It used to save it ending at 23:59, leaving a minute of nothing before whatever starts at midnight, and no drag could make a show end at midnight at all.
