---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
'@deadair/plugin-sdk': minor
'@deadair/plugin-spotify': minor
'@deadair/plugin-ytmusic': minor
'@deadair/plugin-navidrome': minor
---

A playlist can be imported from a link: paste a Spotify, YouTube Music or Navidrome playlist address into the Link tab of the import dialog. This works for playlists your connected account does not list, such as one a friend shared. Each playlist page from a connected source also has a "Save as a station playlist" button, which saves a copy the station keeps and can change independently. For plugin authors, the catalog capability gains an optional `playlistIdFromUrl`, a pure parse that claims a link as one of the provider's own playlists.
