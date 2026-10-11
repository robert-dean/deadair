---
'@deadair/api': patch
---

A record whose measurement was cut short is now measured again. The analyzer answers a transfer that stopped early as a successful but incomplete measurement, which the walk never retried and every reader ignores, so the record aired with no levelling and no cue points for good. It is now retried after an hour, then on a doubling wait capped at a day, so a record whose provider's claimed length is simply wrong costs one attempt a day rather than one an hour.

A podcast episode is no longer turned up past what its peak allows. Its level was corrected with the record cap of twelve decibels but none of the peak check a record gets, so a quiet master could be lifted into the limiter for the length of an episode. A cut is still always made; a boost now goes only as far as the headroom under the measured true peak, and not at all when no peak was measured, which today is every episode. A book or column the station reads out itself keeps the boost the station's own voice gets.
