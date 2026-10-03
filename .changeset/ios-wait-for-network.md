---
'@deadair/ios': patch
---

A stream that drops while the phone has no network now waits for one instead of retrying against nothing. It used to say it could not reach the stream after five minutes, even when the signal came back seconds later; now it reconnects the moment a network is back, starting again from a short wait, and gives up only after fifteen minutes without one.
