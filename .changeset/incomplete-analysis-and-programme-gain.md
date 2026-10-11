---
'@deadair/api': patch
---

A record whose measurement was cut short is now measured again. The analyzer answers a transfer that stopped early as a successful but incomplete measurement, which the walk never retried and every reader ignores, so the record aired with no levelling and no cue points for good. It is now retried after an hour, then on a doubling wait capped at a day, so a record whose provider's claimed length is simply wrong costs one attempt a day rather than one an hour.
