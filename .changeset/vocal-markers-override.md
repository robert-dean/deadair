---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

A record's page now shows where the singing starts and stops, worked out from its timed lyrics, and an operator can correct it or mark the record instrumental. A correction wins until it is cleared, and nothing automatic ever overwrites it. `GET`, `PUT` and `DELETE /catalog/tracks/{id}/vocal-markers` answer with the two times and where they came from, never the words.
