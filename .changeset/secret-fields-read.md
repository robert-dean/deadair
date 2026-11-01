---
'@deadair/plugin-apple-music': patch
'@deadair/plugin-ticketmaster': patch
'@deadair/plugin-weather': patch
---

Read each plugin's secret field through `host.secrets`, so a saved Ticketmaster key, OpenWeatherMap key or MusicKit private key is actually used.
