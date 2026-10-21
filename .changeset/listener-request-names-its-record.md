---
'@deadair/api': minor
---

A listener's request now says which record it was for: `ListenerRequest` carries the record's `trackId`, so an app can offer to ask for it again from the listener's own list of requests.
