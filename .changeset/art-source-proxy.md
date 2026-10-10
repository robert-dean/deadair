---
'@deadair/api': patch
'@deadair/web': patch
---

No page, list or player is handed a music provider's cover address any more, cached or not. Albums, artists, tracks, the play history, the running order, provider playlists and `/nowplaying` all name a cover the station has not cached yet by a station address that fetches it on first view and serves it as the station's own, so covers show straight away while the provider's address, and any username or token in it, never leaves the station. The per-provider enrichment panels (an artist's picture, a record's or a track's artwork) follow the same rule. Anything a provider adds outside the fields the station knows is shown without any web address in it.
