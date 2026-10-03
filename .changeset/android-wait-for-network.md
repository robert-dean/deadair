---
'@deadair/android': patch
---

A stream that drops while the phone has no network now waits for one instead of retrying against nothing. It used to give up and stop after five minutes, even when the signal came back seconds later; now it reconnects the moment a network is back, starting again from a short wait, and stops only after fifteen minutes without one.
