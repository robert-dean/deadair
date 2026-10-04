---
'@deadair/api': minor
---

You can now put a whole album on air. Press **Air this album** on an album's page in the Library, and it plays in the order it was made, by disc and then by track, with no breaks or blends between its records, stopping at its end or when the schedule's next block starts. The order comes from the track and disc numbers Navidrome and Spotify report, which the library now keeps as it syncs; albums synced before this pick their numbers up on the next sync. The API route is `POST /playout/album`.
