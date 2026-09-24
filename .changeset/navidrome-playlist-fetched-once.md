---
'@deadair/plugin-navidrome': patch
---

A long Navidrome playlist is fetched once per read instead of once for every fifty records on it. Navidrome hands back a whole playlist at a time, so reading one of a few thousand records used to fetch all of it again for every page, which made syncing it slow and could leave a scheduled block built on it unable to start.
