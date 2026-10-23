---
'@deadair/api': minor
'@deadair/sdk': minor
---

Putting the station on air (`POST /director/air`) can now lift its repeat rules for that broadcast. `repeatWindowDays`, `artistCooldownMinutes` and `maxPerArtist` each replace the station's own setting for as long as the broadcast runs, and 0 lifts the rule. An hour of one artist sets the cooldown to 0 and raises the cap. A dislike and a never-play rule still apply.
