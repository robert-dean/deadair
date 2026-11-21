---
'@deadair/plugin-lastfm': patch
---

The Last.fm plugin's settings no longer call its API key free. Since 1 December 2026 Last.fm only accepts a key whose account has a Last.fm Pro subscription, so the key field now says so. If your station uses Last.fm for tags, charts, similar artists or scrobbling and the account behind your key is not on Pro, all of those stop working until it is. Deezer and MusicBrainz still cover similar artists without it.
