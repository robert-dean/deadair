---
'@deadair/streamdeck': patch
---

When the station asks the keys to slow down with a date rather than a number of seconds, which a proxy in front of it may do, the plugin now waits until then instead of falling back to its own backoff.
