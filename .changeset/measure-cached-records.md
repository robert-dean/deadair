---
'@deadair/api': patch
---

A record fetched ahead of its slot is now measured as soon as its audio arrives, instead of waiting for the hourly measurement pass, so one cached in the hour before it airs is levelled and trimmed rather than going out at its raw level. The new `catalog.analyze_track` job runs one at a time, skips a record that is already measured, and sends nothing when no analyzer is in use. Every measurement, from the hourly pass or the new job, now counts against `analysis.concurrency` together, so the setting holds across both. The hourly pass stays as the backfill for the rest of the library.
