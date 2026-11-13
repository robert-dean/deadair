---
'@deadair/api': minor
---

A hard marker on the format clock now airs on its time when the music runs late: the record playing at that time is faded out early to end on it, by at most `rotation.hardMarkerMaxCutSeconds` (two minutes by default). The planner picks the record and the pusher works out the exact cut against what is actually on air, half a second late rather than early. A marker the cut cannot reach airs at the boundary after its time, as a soft one does, and the log says why.
