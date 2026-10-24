---
'@deadair/api': minor
'@deadair/sdk': minor
---

A schedule slot and `PutOnAirInput` take `writerOrder` (`model` or `station`), which is copied onto the running order's rules and decides which writer that show's breaks ask first, in place of the station's `llm.breakWriterOrder`. Absent follows the station.
