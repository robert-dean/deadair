---
'@deadair/api': minor
'@deadair/sdk': minor
---

A schedule slot can carry its own repeat rules. `repeatWindowDays`, `artistCooldownMinutes` and `maxPerArtist` on a slot are copied onto the running order when the slot starts, so a scheduled hour of one artist can lift the cooldown and the cap for as long as it runs. Absent keeps the station's own settings.
