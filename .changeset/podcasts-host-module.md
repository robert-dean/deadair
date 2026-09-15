---
'@deadair/api': minor
'@deadair/sdk': minor
---

The station keeps a record of the podcast episodes it knows about. Every half hour it reads the newest episodes of every show its podcast plugins carry and remembers each one, with what the feed said about it and, later, whether the station fetched its audio and whether it aired. `GET /podcasts/shows` lists the shows, `GET /podcasts/episodes` lists the episodes newest first, and `POST /podcasts/refresh` asks for a refresh now. The typed SDKs gain the matching `podcasts` client.
