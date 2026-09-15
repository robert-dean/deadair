---
'@deadair/plugin-sdk': patch
---

`parseFeed` no longer drops an entry whose title is written twice. A podcast entry usually carries both `<title>` and `<itunes:title>`, which arrive together once namespace prefixes are removed, and every such entry used to be discarded as untitled. The first readable one is now used, for every field read this way.
