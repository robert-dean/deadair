---
'@deadair/api': patch
---

A scheduled block set to stop when it runs out no longer keeps every block after it off the air. When its records were spent the station stood down, and the schedule leaves a stood-down station alone because Stop is an operator taking it out of service, so the next block never started and the timetable read as though something had been put on by hand. The station now records whether it stopped because the programme ran out or because somebody pressed Stop: a block that ran out stays quiet until the next one begins, which then starts on time, and a station you stopped yourself is still left alone.
