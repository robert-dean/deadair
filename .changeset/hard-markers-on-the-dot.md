---
'@deadair/api': minor
'@deadair/sdk': minor
---

A rule on the format clock at a time of day can now be switched to On the dot, and it then airs exactly at its time instead of when the record playing at that time finishes. When the music runs late, that record is faded out over about three seconds to end on the time, by at most "Seconds a hard marker may cut" (two minutes). When the music runs early, the station waits for the time rather than airing ahead of it, playing a recording of kind `bed` and fading it out on the time, for at most "Seconds a hard marker may wait" (a minute) and only with a bed half a minute longer than the wait. Both settings are under Settings, Breaks, and zero switches either half off. Where it could do either it takes whichever moves the music less; where it can do neither the rule airs late, as before, and the log says why. Clock files carry the switch.
