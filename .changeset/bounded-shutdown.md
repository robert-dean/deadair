---
'@deadair/api': patch
---

Stopping or restarting the station now takes at most 30 seconds, whatever a part of it is stuck on, and a part that fails while shutting down is logged once instead of also being reported as one that ran out of time. An unexpected error in the moments before the station starts listening is now reported only in the container's own log, and no longer in `logs/`.
