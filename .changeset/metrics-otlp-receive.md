---
'@deadair/api': minor
'@deadair/web': minor
---

The station can keep your other services' metrics beside its own. Turn on "Take metrics from other services" under Settings, Telemetry, and point an OpenTelemetry exporter (OTLP over HTTP, JSON) at the station's address followed by `/api/otlp` with an operator's API key. What arrives is kept like the station's own numbers and drawn on the Trends tab under "From your other services", one metric at a time. Each metric keeps at most 50 label sets by default, so a service that labels every request cannot fill the disk. The Trends charts also draw a lone reading as a dot rather than leaving it invisible.
