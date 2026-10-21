---
'@deadair/plugin-lastfm': patch
---

A track's Last.fm wiki no longer ends with "Read more on Last.fm.", which the break writer was being handed as a note about the record. The link back is now recognized over `http://` and with other attributes, the licence line a `content` body ends with is stripped, and a wiki that was nothing but the link contributes no note at all.
