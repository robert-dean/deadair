---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/desktop': patch
'@deadair/web': minor
---

A schedule slot, and a broadcast put on air by hand, can name moods to steer away from with `avoidMoods`. A record a model judged to be in one is half as likely to be picked for the whole of the slot, and never kept off the air for it: the judgement is right about half the time, so refusing a record outright stays a never-play rule's job. The console's slot editor sets them under **Steers away from**, and the desktop app keeps a slot's avoided moods when it saves the slot.
