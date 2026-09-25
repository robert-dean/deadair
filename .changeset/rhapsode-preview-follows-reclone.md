---
'@deadair/plugin-rhapsode': patch
---

A voice re-cloned on the Rhapsode server under the same id now previews in its new voice. The preview was cached under the station's own voice row, which a re-clone does not change, so the console kept playing the old recording.
