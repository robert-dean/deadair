---
'@deadair/api': minor
---

A cap on how many people can listen at once. **Settings > Stream > Most listeners on each stream**,
which is **off** (zero) until you set it.

The number applies to each stream separately: the MP3 mount, each extra format you have switched on,
and HLS. Somebody already listening is never cut off; only a new listener is turned away. Saving it
restarts the stream server, which drops everyone listening for a few seconds. A station that sets no
cap renders exactly the stream config it rendered before, so upgrading restarts nothing.
