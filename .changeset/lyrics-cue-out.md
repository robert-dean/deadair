---
'@deadair/api': patch
'@deadair/sdk': patch
---

`GET /nowplaying/lyrics` now carries `cueOutMs`, where in the file the record stops playing, and sends both cues only when the player was actually given them. The decoder counts its remaining time down to that point, so an app finds the line being sung as the cue-out (or the record's length) minus the time remaining.
