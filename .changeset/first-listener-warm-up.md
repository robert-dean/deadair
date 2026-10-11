---
'@deadair/api': patch
---

A first listener now hears the station start on its first record instead of a few seconds of the station ident. When somebody tuned in to a station that was waiting for an audience, the stream played the bundled ident for 5 to 12 seconds while the first record downloaded, and the log called it the station airing its local bed instead of the running order. The stream now stays quiet for those seconds and starts on the record the moment it is ready. If the first record takes longer than 15 seconds, the ident plays as before.
