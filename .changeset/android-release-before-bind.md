---
'@deadair/android': patch
---

The live wallpaper and the home-screen widget no longer keep the playback service running after they
let go of it. Letting go before the connection had finished (the wallpaper hiding again as the lock
screen flickered, or a widget press giving up) used to leave that connection open for good.
