---
'@deadair/api': patch
---

**The players the station will not serve are now refused on the mounts too.** The list that kept a program off the HLS playlists (Players the station will not serve, Settings, Stream) now also drops matching clients from the Icecast mounts and leaves them out of the audience, so one cannot hold a station that airs only for listeners on air for nobody. Needs Icecast 2.5, and a mount whose client list cannot be read counts everybody on it.
