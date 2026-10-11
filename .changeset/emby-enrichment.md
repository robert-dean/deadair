---
'@deadair/plugin-emby': minor
---

The Emby plugin is now an enrichment source too. It passes on what Emby knows about the library:
genres, years and release dates from your files' tags, and an artist's biography and picture when Emby
has one. It sits behind MusicBrainz, filling gaps rather than overruling it.

Emby labels the MusicBrainz ids it reads, so a release group or artist id from your tags reaches the
station's own records. Emby keeps no recording id, so a track's recording is left for MusicBrainz to
resolve.
