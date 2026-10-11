---
'@deadair/android': patch
---

When the audio drops, the app now writes why to the phone's log under `deadair.playback`: the player's
error and what caused it, or a stall and how long it lasted. Read it with
`adb logcat -s deadair.playback`.
