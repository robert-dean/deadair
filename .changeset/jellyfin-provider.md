---
'@deadair/plugin-jellyfin': minor
'@deadair/api': minor
---

A Jellyfin music provider, bundled. Point it at your server with an API key from the Jellyfin
dashboard and the user to read the library as, and the station can search the library, sync its
audio playlists (plus an Everything playlist that is the whole library), and air the original files
or an MP3 or Opus transcode.

Jellyfin's own search matches track names only, so a query is also read as an artist followed by a
title, and titles are compared without regard to punctuation. A search for a period uses Jellyfin's
year filter, which leaves out tracks whose files carry no year.
