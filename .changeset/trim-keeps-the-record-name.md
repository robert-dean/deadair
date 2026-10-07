---
'@deadair/api': patch
'@deadair/plugin-sdk': patch
---

A talk break that runs past its word limit no longer loses the record it names. The trim used to keep the start of the break and cut the end, which for an outro is where the next record is named, and the break was then thrown out for naming no record at all. Now the trim cuts the sentences just before the name instead, and when no cut can keep the name within the limit, the break is recorded as too long, which is the real reason. The plugin SDK gains `sentencesOf`, which splits a passage into whole sentences on the same rule `sentencesWithin` cuts at.
