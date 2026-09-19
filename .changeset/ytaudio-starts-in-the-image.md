---
'@deadair/plugin-ytmusic': patch
---

YouTube Music records now play from the station image. The service that finds a record's audio was
built into the image but never started, so every fetch, and the provider's **Test connection**,
failed with `ECONNREFUSED localhost:9322` however the provider was set up.
