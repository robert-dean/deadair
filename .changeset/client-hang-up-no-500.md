---
'@deadair/api': patch
---

A request whose client hangs up before the answer is ready (Liquidsoap giving up on a slow segment's audio, for one) no longer ends in a logged 500, and any follow-up work it registered still runs once its transaction has committed.
