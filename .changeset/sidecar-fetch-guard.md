---
'@deadair/api': patch
---

Analysis: the measurement sidecar fetches only `http` and `https` urls, and refuses a redirect that leads to a private address unless it stays on the origin it was asked for or is named in `ANALYSIS_ALLOWED_ORIGINS`. The station's own audio and segment urls are fetched as before.
