---
'@deadair/plugin-ytmusic': patch
---

A long YouTube Music playlist can be read again. The first page of a playlist used to read every record on it before answering, so a playlist of a few thousand records ran out of time before it answered anything: it would not sync, would not import, and a scheduled block built on it never started, leaving the block before it on air. Each page now reads only as far as it needs, and a playlist longer than about four thousand records is no longer cut off at that point.
