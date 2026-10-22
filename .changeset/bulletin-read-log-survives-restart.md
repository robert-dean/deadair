---
'@deadair/api': patch
---

News bulletins no longer repeat stories after the station restarts. The list of headlines already read out was kept only in memory, so every release handed the whole twelve-hour window back and the same story could go out in three bulletins in one morning. It is now written through to Redis and read back after a restart. If Redis cannot be reached the bulletin still airs, and a warning in the log says a story may be repeated.
