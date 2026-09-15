---
'@deadair/plugin-podcast': minor
'@deadair/api': minor
---

A bundled Podcasts plugin reads the podcast feeds an operator subscribes the station to: one row per show with its feed address, each show described from its own feed, and its episodes listed newest first with the address of their audio and how long they run. It can also look a show up by name in Apple's public podcast directory, which is on by default, can be switched off, and can be pointed at a country's store. It never fetches an episode's audio itself, so the only addresses it asks to reach are the feeds and the directory. Nothing on the station uses it yet.
