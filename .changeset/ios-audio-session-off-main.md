---
'@deadair/ios': patch
---

Play and stop no longer wait on the audio session on the main thread. Starting and ending the session waits on the system's media server, and iOS flagged it as a hang risk on every play and stop, measured on a phone; a slow media server could freeze the screen for as long as it took. The station still takes over audio as a music app does, and the silent switch still does not mute it.
