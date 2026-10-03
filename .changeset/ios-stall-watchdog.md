---
'@deadair/ios': patch
---

A stream that stops delivering audio without the player reporting a failure is now reconnected. It used to wait indefinitely while the app said it was playing; now ten seconds of silence after audio has been heard (thirty while the station is starting up) counts as a dropped stream, and it is retried as one.
