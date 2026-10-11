---
'@deadair/plugin-jellyfin': minor
---

The Jellyfin plugin is now an enrichment source too. It passes on what Jellyfin knows about the
library: genres, years and release dates from your files' tags, and the biographies and pictures its
own online lookups found. It sits behind MusicBrainz, filling gaps rather than overruling it.

Jellyfin labels each MusicBrainz id it reads, so a recording, release group or artist id from your
tags now reaches the station's own records, and an id the station already holds confirms or rules
out a match.
