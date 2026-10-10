---
'@deadair/api': patch
---

A show that opens with nothing queued no longer goes silent when the model is slow to choose its records. The station gave the job that fills the running order three minutes, less than the model is allowed to take, so a slow answer was thrown away just as it finished, and with nothing playing nothing asked again. The job now has twelve minutes. A refill that is cut off anyway says so on the activity feed. And while the running order is empty, the station keeps asking for more until it gets some.
