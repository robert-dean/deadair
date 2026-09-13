---
'@deadair/api': patch
---

A break whose audio could not be made because the speech engine was not ready is now asked for again, instead of being passed over at its slot. When the voice server is still loading its model, or cannot load it because another model is holding the GPU, the station keeps the break's words and waits. Nothing ever came back for those breaks: only a welcome was tried a second time, so every other break turned away at the start of a listening session was lost. The station now asks for their audio again each time a record changes while the break is still coming up, and the activity feed says so, as it already did for a break whose render failed outright.
