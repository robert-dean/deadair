---
'@deadair/api': patch
---

Measuring records no longer makes the stream fall behind.

The analyzer that works out where each record starts and ends and how loud it is now runs at a
lower priority than the audio chain. On a busy machine the two used to compete as equals, and while
a batch of records was being measured the broadcast could fall seconds behind real time; once, by
26 seconds. Measuring now waits for the stream instead of the other way round. Nothing changes on a
machine with CPU to spare.
