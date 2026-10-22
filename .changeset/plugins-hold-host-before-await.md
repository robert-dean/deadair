---
'@deadair/plugin-analyzer': patch
'@deadair/plugin-chatterbox': patch
'@deadair/plugin-deezer': patch
'@deadair/plugin-kokoro': patch
'@deadair/plugin-lastfm': patch
'@deadair/plugin-musicbrainz': patch
'@deadair/plugin-navidrome': patch
'@deadair/plugin-rss': patch
'@deadair/plugin-spotify': patch
'@deadair/plugin-wikipedia': patch
---

Saving a plugin's settings while it is mid-request no longer turns that request's ordinary failure into a plugin fault. Ten plugins read their connection to the station again after waiting on a server, which throws once a save has reloaded them, and three such faults take a plugin off the air. They now hold the connection from the start of the request.
