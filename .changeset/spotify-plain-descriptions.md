---
'@deadair/plugin-spotify': patch
---

Spotify playlist descriptions now read as plain words everywhere they are shown. Spotify sends them as HTML, so escapes like `&#x2F;` and link markup were reaching the console and the listener apps as-is.
