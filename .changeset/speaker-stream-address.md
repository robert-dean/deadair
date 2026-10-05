---
'@deadair/api': minor
'@deadair/plugin-cast': patch
---

A new stream setting, **Address for speakers**, says where speakers the station plays on fetch the stream from, when that is not the public URL. Set it to the station's plain `http://` address on your network for a speaker that cannot play HTTPS (some televisions cannot) or cannot reach the public address from inside. Listeners keep the public URL.
