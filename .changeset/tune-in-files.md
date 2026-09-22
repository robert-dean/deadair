---
'@deadair/api': minor
---

Tune-in files for players that take a playlist rather than a stream address: `/listen.pls` and
`/listen.m3u` at the root of the station's address. Each lists every stream the station publishes,
MP3 first, as full addresses on the station's public address, and the `.m3u` adds the HLS stream when
it is on. Point a hardware radio, a car receiver or a desktop player at either. Both need
**Settings > Stream > Public URL** (or the station's own address from the environment), and answer
404 without one.
