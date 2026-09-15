---
'@deadair/plugin-sdk': minor
'@deadair/plugin-lastfm': minor
'@deadair/api': minor
---

A similarity plugin can now name records that sound like one record, not only artists who sound like one artist. `SimilarityProvider` gains an optional `similarTracks(ref, limit)`, taking the enrichment capability's `TrackRef` and answering `ArtistTrack`s, each with its own lead artist. The Last.fm plugin implements it with `track.getSimilar`, asking by MusicBrainz recording id when the catalog has one. When a playlist mixes similar records in, the station now asks about the record each one follows first, and falls back to that record's artist when nothing usable comes back or no plugin can answer. A plugin without the method behaves exactly as before.
