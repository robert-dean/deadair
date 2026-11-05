---
'@deadair/api': patch
---

Restart the audio chain when Icecast has had no source on the mount for ninety seconds. A Liquidsoap whose output had stopped while its control API went on answering used to leave the station off air, with nobody able to connect, until somebody restarted it by hand.
