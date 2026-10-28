---
'@deadair/plugin-sdk': patch
---

Feeds are fetched with conditional GET. The SDK remembers the `ETag` and `Last-Modified` a publisher sent with a feed and sends them back on the next fetch, so a feed that has not changed answers with a 304 and the station reuses the copy it already read. News feeds and podcast feeds both benefit with no change to either plugin.
