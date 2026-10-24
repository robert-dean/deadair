---
'@deadair/plugin-chatterbox': minor
---

Chatterbox keeps its model loaded for as long as the station is on the air. **Free the GPU once the station stops airing** (it was **Free the GPU after a quiet spell**) now counts its minutes from the moment the station goes off the air, rather than from the last thing spoken, so the first break after a long run of records, or after a quiet spell, no longer waits for the model to load. When the station comes on the air, the model is loaded straight away, so the first break after a listener arrives does not wait for it either (except while **Free the GPU between breaks** is on). The station is off the air when its running order runs out, when it is stopped, and a few minutes after the last listener leaves. The default is still 15 minutes, and 0 still means never.
