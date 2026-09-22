---
'@deadair/plugin-musicbrainz': minor
---

The MusicBrainz plugin can scrobble what the station plays to ListenBrainz. **Plugins > MusicBrainz and
ListenBrainz > Scrobble what the station plays to ListenBrainz**, which is **off** until you switch it
on, and needs the ListenBrainz token already in those settings.

It is a second destination beside Last.fm, and the two fail independently: each has its own queue
and its own retries. A token ListenBrainz refuses keeps the plays for later and says so in the log,
without taking the plugin's enrichment or similar artists down with it.
