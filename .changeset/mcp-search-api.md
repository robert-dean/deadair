---
'@deadair/api': minor
---

A connected app can now find any station operation through `search_api`, not just the handful listed as tools. A query answers a short index of matching operations the app may actually use, filtered by the person's role and the app's grant, and a name answers one operation in full, with its arguments. Signing in, credentials, connected apps, station settings, plugin configuration, log files and the long persona model calls are kept out of it.
