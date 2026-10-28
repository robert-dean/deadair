---
'@deadair/api': patch
---

Icecast now records each listener's own address instead of the station's internal proxy for all of them. Behind a tunnel the address is only real once `REAL_IP_FROM` is set, as it already is for HLS listeners. Icecast restarts once when this update is applied, so anyone listening at that moment reconnects.
