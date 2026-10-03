---
'@deadair/android': patch
---

Moving between wifi and mobile data no longer leaves the stream on the network it started on. An MP3, AAC, Opus or FLAC stream is reconnected over the new network the moment the phone switches, instead of going silent until the old connection times out, and a reconnect that was already waiting is made at once. HLS, which fetches each piece of audio afresh, is left as it is.
