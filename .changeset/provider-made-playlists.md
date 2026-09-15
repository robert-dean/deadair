---
'@deadair/plugin-sdk': minor
'@deadair/plugin-spotify': minor
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

The playlists Spotify makes for you (Discover Weekly, the Daily Mixes, Release Radar and its editorial lists) no longer fill the Playlists page with cards Spotify refuses to share. They now sit behind **Show N made by Spotify** under your own playlists, and the count at the top counts only the ones a person made. Nothing is removed: open the button and they are all there. For plugin authors, `ProviderPlaylist` gains an optional `madeByProvider`, and `CatalogPlaylist` carries it through.
