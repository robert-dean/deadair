---
'@deadair/api': patch
'@deadair/plugin-sdk': minor
'@deadair/plugin-analyzer': patch
'@deadair/plugin-deezer': patch
---

A record whose audio could not be fetched for measuring is now tried again after an hour instead of a day. A file that would not decode still waits a day, because retrying it means downloading and decoding the same bytes again. The analyzer's own reason is stored with the failure (`track_analysis.failure_code`). `PluginError` gains an optional `upstreamCode` (`withUpstreamCode`) for an upstream's own name for a failure, and the analysis capability exports `ANALYSIS_FAILURE_CODES`, the three values it understands.
