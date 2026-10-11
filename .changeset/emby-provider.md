---
'@deadair/plugin-emby': minor
'@deadair/api': minor
---

An Emby music provider, bundled. Point it at your server with an API key from Emby's server settings
and the user to read the library as, and the station can search the library, sync its playlists (plus
an Everything playlist that is the whole library), and air the original files or an MP3 or Opus
transcode.

Emby cannot list audio playlists apart from video ones, so every playlist the user can see appears,
and a video playlist brings no records. A search for a period leaves out tracks whose files carry no
year.
