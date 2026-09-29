---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': patch
---

The Playlists page lists each music source's playlists as the library sync last read them, instead of asking every source while the page loads. A slow or rate-limited Spotify no longer leaves the page empty, and a source that has stopped answering still shows its last list beside the warning. Each source says when its list was read, and Refresh now updates the lists on the page as each source answers. The playlist listing response gains an optional `sources` field with that time.
