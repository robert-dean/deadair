---
'@deadair/api': patch
---

A running order that ends on Stop now plays its last records out before standing down. It used to stand down the moment the player fetched the final record ahead of time, which cut off the record on air and never played the last one.
