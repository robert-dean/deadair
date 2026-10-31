---
'@deadair/ios': patch
---

A retry that hangs is now timed out like the first one, so the app moves on to the next attempt and eventually says the station is unreachable, instead of staying on warming up or reconnecting until the system gives up.
