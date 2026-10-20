---
'@deadair/android': minor
---

When the stream stalls for four seconds on a wifi that has stopped passing anything, the app moves it to the phone's mobile data instead of waiting for Android to give up on the wifi, which took nineteen seconds on a walk. It goes back to following the phone's own choice of network as soon as Android moves on, or when you stop. The playback log says each time it happens, and when there was no mobile data to move to.
