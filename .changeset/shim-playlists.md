---
'@deadair/plugin-spotify': minor
'@deadair/plugin-sdk': minor
'@deadair/api': minor
---

Spotify playlists you follow but do not own now work. An editorial playlist, a Daily Mix, a playlist a friend made: all of them were listed with **Spotify won't share this playlist's tracks** and can now be viewed, aired, picked for a schedule block and used for a persona audition, because the station's own track fetcher reads them on the login it already holds for fetching audio. It needs that fetcher authorized (Plugins → Spotify → the playback authorization card); without one, those playlists read exactly as they did before.

Two things follow from it. The hourly library sync now reads those playlists too, so the records in them join your library from the next run: hide a playlist from its card on the Playlists page to keep it out. And Spotify marks almost nothing on this path as clean or explicit, so a station set to **clean only** will play very little from a followed playlist, which is the honest outcome rather than a station vouching for records nobody vouched for.

For plugin authors, `PluginTrackFetcher` gains `playlistTracks(request)` for the playlist your own API lists and then refuses.
