---
'@deadair/sdk': patch
---

A resumed event stream no longer skips an event that was cut off before it was dispatched, and a cursor the server cleared is no longer sent back as an empty `Last-Event-ID` header.
