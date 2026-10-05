---
'@deadair/api': minor
'@deadair/plugin-cast': patch
---

UPnP/DLNA speakers that check a stream before playing it, Samsung televisions among them, now play the station: the stream answers that check itself instead of refusing it, which those speakers read as "resource not found". And a new stream setting, **Address for speakers**, says where speakers fetch the stream from when that is not the public URL, for a speaker that cannot reach the public address from inside your network.
