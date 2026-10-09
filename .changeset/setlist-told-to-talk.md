---
'@deadair/api': minor
'@deadair/sdk': minor
---

A setlist can have a host now, which is what a chart countdown is. A schedule slot and `PutOnAirInput` each take `breaks`: set it true on a setlist and the host talks between the records as often as the station's own settings say, plays its jingles, greets a new listener and marks a change of programme, while the records play exactly as the setlist has them (nothing cut by a cooldown or a cap, nothing generated or mixed in, and no calls unless they are asked for too). Leaving it unset keeps each mode's own answer, so a rotation talks and a setlist stays silent exactly as before; `false` makes a rotation play without talking. A feature stays silent whatever it says, since an album played whole is the case nothing talks over. Before this a setlist told to talk turned breaks on with a spacing of zero, which is off, so a scheduled countdown played record after record with its host silent.
