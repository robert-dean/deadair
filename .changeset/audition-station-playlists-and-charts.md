---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

A character can now be auditioned over the station's own playlists and over charts, as well as over a provider's playlist. The picker on Voice, Auditions is renamed "Records from" and lists the station's playlists first, then the providers' playlists, then the charts, the same way the programme picker does. A station playlist is read with its placeholders, because a record the library does not hold yet is still one the host can talk about. A chart is read from the top, and its entries are never looked up at a provider, because nothing in an audition airs. An entry the library already holds still brings its facts. In the API, `POST /personas/{id}/auditions` takes `stationPlaylistId` or `chartId` instead of `pluginId` and `playlistId`, and answers 422 unless exactly one source is named. An audition's `source` now carries whichever of the three it was.
