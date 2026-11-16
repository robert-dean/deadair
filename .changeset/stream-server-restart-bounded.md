---
'@deadair/api': patch
---

Saving a stream setting can no longer leave the station off air behind a stream server that will not stop. The container restarts Icecast when its config changes, and an Icecast that closed its port but never exited used to be waited on for ever, with nothing else restarted or noticed until somebody killed it by hand. Icecast and the track shim are now stopped within ten seconds whatever they do, the way the audio chain already was, and the station comes back on its own.
