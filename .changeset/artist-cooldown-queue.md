---
'@deadair/api': patch
---

"Do not repeat an artist for (minutes)" now holds for records still waiting in the running order, not only for ones that have aired. Two records by the same artist could land about eight minutes apart inside one refill, and a refill could choose an artist already queued a few records earlier; the station now keeps an artist's records at least that many minutes apart by when each is expected to air. On a library too small to fill the hour that way, the station repeats an artist sooner rather than running out of music. Setting it to 0 still turns it off.
