---
'@deadair/api': patch
---

A failed lyrics or enrichment plugin call is now logged as one warning instead of two. The plugin host's "plugin call failed" line stays and carries the operation and the failure count. The lyrics and enrichment passes now write their own line, with the record it was about, at debug level.
