---
'@deadair/api': patch
---

A refill that runs out of time is no longer mistaken for one a break interrupted. The station gives the model three minutes to choose an hour's records, and a break that needs the model can take it back sooner; both used to be reported as the break's doing, so a refill that had simply used its three minutes was started again for three more, with nothing waiting for the model. It now says it ran out of time, fills the hour from what its searches found or from ordinary rotation, and moves on.
