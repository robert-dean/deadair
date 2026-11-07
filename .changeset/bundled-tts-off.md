---
'@deadair/api': patch
---

The speech server inside the `latest` and `full` images can be left off with `BUNDLED_TTS=off`, for an operator who already runs a speech server elsewhere and has pointed the speech plugin at it. The database and cache on `full` are unaffected, and `on` (the default) starts it again with the same voices.
