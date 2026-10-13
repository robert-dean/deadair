---
'@deadair/api': patch
---

A record whose cover the station had not cached yet now shows its artwork on a BluOS player. The stream advertised that cover as a bare `art/source/<token>` path, which BluOS ignores because it only fetches a URL that ends like an image; it now carries `/cover.jpg` like every other cover the station sends.
