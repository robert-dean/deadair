---
'@deadair/android': patch
---

Catch back up to the station after the stream stalls. Each stall used to leave the app that much further behind for the rest of the session (up to about 30 seconds on HLS, with no limit on MP3); once it is more than eight seconds behind, the app now jumps back to live when the next record starts, never during a break.
