---
'@deadair/api': minor
'@deadair/web': patch
'@deadair/sdk': minor
---

A new show can travel from one artist to another. In Plan the station, a new show takes a From and a To artist; the station finds a way between them through artists your library holds, one record each, where every step is either a record the two artists are credited on together or a similarity source naming them alike, and Preview the route shows each stop and how it connects before anything airs. On air, the presenter can say how a record connects to the one before it. Over the API this is `routeFrom` and `routeTo` on `PutOnAirInput`, and `POST /director/route/preview`.
