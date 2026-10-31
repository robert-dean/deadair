---
'@deadair/api': patch
---

A listener joining the Opus mount after an idle spell starts at the live edge instead of tens of seconds behind it, because the mount now encodes at a constant bitrate and its burst stays half a second long.
