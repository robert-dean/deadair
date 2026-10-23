---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
'@deadair/desktop': minor
---

A record, a release or an artist can be suspended from its page in the console: **Suspend** for a day, a week or a month keeps it off the station without touching your rating, the page says how long is left, and **Lift** ends it early. The tracks list counts and filters what is suspended and marks a suspended row, and the desktop app's record list has the same filter. On the API, `TrackState` gains `suspended` and the state counts carry `suspended`.
