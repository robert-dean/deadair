---
'@deadair/api': patch
---

The station's audio now runs on Liquidsoap 2.4.6. It fixes two bugs 2.4.5 had in the station's own path. A Liquidsoap left running for weeks no longer slowly climbs in CPU until a restart. And the start of a break, or of a record after a short join, no longer loses up to a frame of audio. The ffmpeg the image installs for measuring records is now Debian's 7.1.5 rather than deb-multimedia's 7.1.4.
