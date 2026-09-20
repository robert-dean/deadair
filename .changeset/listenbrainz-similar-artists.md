---
'@deadair/plugin-musicbrainz': minor
---

Similar artists from ListenBrainz, with no token needed

The MusicBrainz plugin now also answers who sounds like an artist, using
ListenBrainz's listening data. It is the same organisation's data under the
same ids, which is why it lives here rather than in a plugin of its own, and
it is now called **MusicBrainz and ListenBrainz** on the plugins page.

The ListenBrainz token stays optional and does the same job it always did:
enrichment in batches rather than one request a second. Similar artists work
whether or not you have pasted one in, because the endpoint behind them is open
to anyone.

If you already run Last.fm, this sits alongside it. The station keeps every name
both sources offer rather than picking between them, so the pool it programmes
from gets wider.
