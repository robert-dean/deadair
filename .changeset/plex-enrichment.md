---
'@deadair/plugin-plex': minor
---

The Plex plugin is now an enrichment source too. It passes on what Plex's metadata agents know about
the library: each record's label, release date and styles, each track's moods, and each artist's
biography, picture and MusicBrainz id. It sits behind MusicBrainz, filling gaps rather than
overruling it.

Plex's album and track MusicBrainz ids are a release and a track, not the release group and recording
the station keeps on its records, so they are kept alongside the other ids without being written
over either. An artist or record whose Plex id changed after a rescan is found again by name.
