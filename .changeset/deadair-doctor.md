---
'@deadair/api': minor
---

`docker exec deadair deadair-doctor` checks that a container is set up right and says what to fix, one line per check. It covers the data volume (mounted, and writable by the station), the two keys and where they came from, the database and whether its schema is current, the cache, the station's address, and whether the speech model's weights are downloaded yet. It also checks that the API is answering. It exits non-zero when a check fails. Why a running station is quiet is still the console's Check-up page, and the doctor points there.
