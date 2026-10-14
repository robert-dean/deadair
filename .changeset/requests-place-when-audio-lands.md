---
'@deadair/api': patch
---

Requests: a request waiting on its record's audio is placed the moment the audio arrives, rather than at the next minute's retry, so it no longer lands a record later than it had to when the running order moved on in between.
