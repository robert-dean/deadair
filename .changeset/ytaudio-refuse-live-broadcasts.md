---
'@deadair/plugin-ytmusic': patch
---

YouTube Music no longer tries to play a live broadcast, a premiere that has not started, or a stream that is still being processed. The audio resolver now reports these as unavailable, so the station skips them and does not retry. A record whose length YouTube reports as not a number is now treated as having an unknown length. Before, the resolver failed on it.
