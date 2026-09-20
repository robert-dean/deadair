---
'@deadair/plugin-musicbrainz': minor
---

Records that sound like one record, from ListenBrainz

When the station mixes similar records into a playlist it would rather ask
"what do people play alongside this record" than "what else is by someone who
resembles this artist". With a ListenBrainz token set, the plugin now answers
the first question. Massive Attack's *Teardrop* comes back as Glory Box, Roads,
Sour Times, Porcelain and In the Waiting Line.

It needs the token because of how the data is keyed. MusicBrainz holds a
separate recording id for every release a song appeared on, and the similarity
data exists only against the one ListenBrainz treats as canonical; finding that
one is a lookup only a token can make. Without a token the station keeps the
answer it had, which is to reach for a record by a similar artist instead.

This adds `labs.api.listenbrainz.org` to the plugin's network permissions,
paced on the same budget as the rest of ListenBrainz.
