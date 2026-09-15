---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
'@deadair/plugin-sdk': minor
---

A podcast can go on the format clock. Add a show as a topic of the new `syndicated` kind, then put a `syndicated` band on the schedule about it: three hours before the slot the station fetches the show's newest episode, and at the slot it airs it, if it has not aired it already. A band declines rather than airing an older episode or a different show, and a programme is still carried when the station's own talking is switched off. An episode's stated length now counts on the station's clock, so a bulletin at the top of the next hour lands after the programme rather than an hour early, and a bulletin at the boundary a programme ends on is kept rather than dropped as a second break. Plugin settings can offer the shows the station carries with the new `station.podcastShows` option source.
