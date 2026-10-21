---
'@deadair/api': patch
---

The station's timings (how long jobs, renders and model calls take) now reach an OTLP collector with their full spread, so Prometheus, Grafana or Google Cloud can show a 95th percentile and not just the average and the worst. Google Cloud accepts them at all now: it refused them before. Trends in the console is unchanged.
