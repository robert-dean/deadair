---
'@deadair/api': patch
---

A slow refill is no longer joined by a second one asking for the same records. The station waited five minutes before asking again while a refill may now take twelve, so every slow one was doubled and both landed. It now waits for as long as a refill may run, and asks again soon after one comes back empty or could not be sent at all, which also covers a show that had nothing playing and stayed silent after a failed send. A show put on air by hand is no longer prepared again every minute while it plays. A refill, replan or show preparation that is stopped now lets go of the model and stops looking records up straight away, and the activity feed says when one ran out of time, and stays quiet when it was only the station restarting.
