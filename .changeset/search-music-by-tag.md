---
'@deadair/api': patch
---

When a similarity source can name records by tag, the model's music search takes a style as `tags` and finds records in it at the providers, not only songs with the word in their title. A record the station does not own is offered only after a provider is found to carry it, at most eight per search, so every result stays one the station can play. The refill prompt tells the model to use it only on a station where it works.
