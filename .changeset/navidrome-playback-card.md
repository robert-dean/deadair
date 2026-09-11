---
'@deadair/web': patch
---

Navidrome's plugin page no longer shows the playback authorization card. That card authorizes the station's own track fetcher, which only Spotify uses. Navidrome was being offered a Spotify login it has no use for and, once enabled, a warning that every record would be dropped.
