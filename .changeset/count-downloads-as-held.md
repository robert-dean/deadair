---
'@deadair/api': patch
---

The station no longer throws away its own next record when the audio chain is slow to fetch it. If a record took more than five seconds to download, the station decided it had been lost and sent it again, then saw two copies and cleared both, which could leave a listener hearing the fallback music for several seconds. The audio chain now reports what it is still downloading, and the station counts that as delivered.
