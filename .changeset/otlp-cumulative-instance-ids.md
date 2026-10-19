---
'@deadair/api': patch
---

The station's OTLP metrics now send counters and histograms as running totals (cumulative) rather than per-minute deltas. Every minute used to go out as two points over the same interval, because the flusher sends the still-open minute and then the rest of it, and a collector kept only one of them, so token, failure and duration counts read low. Prometheus now takes them with no `deltatocumulative` processor. Each station process also reports its own `service.instance.id` (a UUID made at boot) instead of the constant `main`, so a restart or a deploy's overlap is a new series rather than one whose total goes backwards; the station key moves to `deadair.station`.
