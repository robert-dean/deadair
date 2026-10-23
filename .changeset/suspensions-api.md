---
'@deadair/api': minor
'@deadair/sdk': minor
---

An artist, a release or a record can be kept off the station for a while without disliking it. `PUT /catalog/{artists,albums,tracks}/{id}/suspension` with `days` keeps it out of every draw, search, request and route until then, a suspended artist included on records they only guest on, and `DELETE` ends it early. The rating is left alone, so a liked artist suspended for a week is still liked when it lapses, and nothing sweeps it: it simply stops applying. Each of the three carries `suspendedUntil` while a suspension is in force.
