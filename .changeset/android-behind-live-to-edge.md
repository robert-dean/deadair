---
'@deadair/android': patch
---

When an HLS stream falls behind the station's playlist after a stall, the app now jumps straight to what is live instead of failing and retrying, which brought the audio back in about a second and a half. If it falls behind again within half a minute it is treated as a real failure and retried as before.
