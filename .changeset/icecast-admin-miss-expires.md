---
'@deadair/api': patch
---

A stall no longer leaves the station reading Icecast's deprecated stats endpoint until it restarts. When the admin endpoint times out, drops the connection or answers a 5xx, the poll falls back as before, then tries the admin endpoint again after five minutes, as it already did after a refused password. While the station was stuck on the fallback, Check-up → Listeners reported every mount as "has not found an Icecast 2.5 it can ask". A 404 still means a 2.4 server and is not retried.
