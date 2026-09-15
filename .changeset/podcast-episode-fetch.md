---
'@deadair/api': minor
'@deadair/sdk': minor
---

The station can fetch a podcast episode's audio into its own store, where it becomes a segment ready to air, with `POST /podcasts/episodes/{id}/fetch`. The download follows the analytics redirects podcast audio sits behind, refuses any address that resolves to this machine or its network, decides what the file is from its first bytes rather than from what the publisher says, and streams to disk under a 256 MB ceiling. On air an episode is named on the mount by its title and its show, reported to listeners as a programme rather than as the station talking, levelled from the loudness a mastered podcast has rather than the station's quieter speech engine, and kept out of play history and scrobbling. Episodes are never drawn at random from the segment shelf.
