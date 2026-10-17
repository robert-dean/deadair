---
'@deadair/api': minor
'@deadair/sdk': minor
---

The station's numbers can be read back: `GET /metrics/series` answers any of them over a range, by the minute for two days or less and by the hour beyond, and `GET /metrics/names` lists every metric it holds with its labels. Both need a signed-in listener or operator, like Check-up. The SDKs carry them as `sdk.metrics.readMetricSeries` and `sdk.metrics.readMetricNames`.
