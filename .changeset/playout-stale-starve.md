---
'@deadair/api': patch
---

The station no longer goes on saying it is airing Liquidsoap's local bed after Liquidsoap has been restarted. A restarted Liquidsoap never reports the end of a gap the old one reported, so the console and `/playout/status` could call a station that was playing its running order "starved" for as long as it stayed up. The gap now also ends when Liquidsoap says its queue is producing, when an item is confirmed on air, or when the old process is gone.
