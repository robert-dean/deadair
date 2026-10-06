---
'@deadair/api': minor
---

A soundboard sound can now say where in a break it may land and when to reach for it. Each pad carries its placements (before the first word, between two, after the last) and an optional cue in your own words, such as "right after a punchline", set through `PUT /pads/{id}/use`. Every pad starts out allowed everywhere with no cue, so nothing a station already airs changes until somebody sets one; the writers and the console start reading these in the releases that follow.
