---
'@deadair/plugin-deezer': patch
---

When Deezer refuses a request inside an otherwise successful answer, the plugin's error no longer reports the upstream status as 200. It still carries Deezer's own error code, which is what says what went wrong.
