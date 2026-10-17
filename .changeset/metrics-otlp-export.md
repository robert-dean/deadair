---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

The station can send its numbers to your own OpenTelemetry collector. Settings has a Telemetry section: name a collector (OTLP over HTTP), add any headers it needs (kept encrypted, like a password), and each minute's listeners, work, model and library numbers go there as well as to the Trends tab. A collector that is down is logged once and never holds up the station.
