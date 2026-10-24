---
'@deadair/plugin-chatterbox': minor
---

Chatterbox keeps its model loaded for as long as the station is on the air. **Free the GPU once the station stops airing** (it was **Free the GPU after a quiet spell**) now counts its minutes from the moment the station goes off the air, rather than from the last thing spoken, so the first break after a long run of records, or after a quiet spell, no longer waits for the model to load. The station is off the air when its running order runs out, when it is stopped, and a few minutes after the last listener leaves. The default is still 15 minutes, and 0 still means never.
