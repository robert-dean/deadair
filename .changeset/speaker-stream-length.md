---
'@deadair/api': patch
'@deadair/plugin-cast': patch
---

Samsung televisions, and other UPnP/DLNA renderers that will not play a stream with no length, now play the station: they used to say "This file format is not supported". The Speakers plugin asks for the live stream with a declared length for a UPnP renderer, and only for one, so nothing changes for anybody else listening.
