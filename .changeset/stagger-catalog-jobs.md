---
'@deadair/api': patch
---

The hourly library sync now runs at four minutes past the hour instead of on it, and the quarter-hourly enrichment walk and the ten-minute art cache pass moved off the round minutes too. The hour is when a show changes and the station builds its new running order, so a full library walk on the same minute competed with it for the music server, which on a slow server is how requests time out.
