---
'@deadair/api': minor
---

A skip can say which record it means: `POST /playout/skip?item=<id>`, with the id of the record on air as you last saw it. When that record has already finished, the station refuses with "That had already finished, so nothing was skipped." rather than cutting the record that started after it. A console only reads the station every few seconds, so a press could land on the next record and take it off for every listener. A skip without the id behaves exactly as before. The generated SDKs take the id as an optional query.
