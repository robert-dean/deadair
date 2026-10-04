---
'@deadair/api': minor
---

A presenter can now have a picture. Drop one onto a host's character sheet on the Personas page (JPEG, PNG, WebP or GIF, up to 4 MB), and it is saved straight away. While that presenter is on air, the station's now-playing answer carries the picture as `show.hostArtUrl`, so listener apps can show who is talking. Replacing a picture keeps its address, so a player already showing it picks up the new one. A presenter with no picture is unchanged.
