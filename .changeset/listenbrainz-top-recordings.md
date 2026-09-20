---
'@deadair/plugin-musicbrainz': minor
---

Name an artist's records from ListenBrainz, with a token

Similar artists tell the station who to reach for; this is what it actually
plays by them. With a ListenBrainz token set, the plugin now answers an
artist's best known recordings, ordered by how much they are listened to.

It needs the token, and says nothing without one. The endpoint behind it
refuses anonymous callers, and the open endpoint that looks like a substitute
is a radio sampler: asked for Daft Punk's best it offered a four-track medley,
a mashup and a radio edit, and asked for Portishead's it offered album
interludes and live takes. Records by the right artist that nobody would have
chosen are worse than no answer, because the station has other sources and this
one would have spoken over them.

So: no token, and this contributes similar artists while Deezer or Last.fm name
the records. With a token, all three answer and the station asks them in turn.
