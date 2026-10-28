---
'@deadair/api': patch
'@deadair/sdk': patch
---

When the model says why it picked a record, the reason is now kept with the record until it airs, and the as-run log carries it: `AsRunEntry.pickedBecause` on `GET /history/as-run`. It never leaves the station: event destinations, chat platforms and now playing do not see it.
