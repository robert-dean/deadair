---
'@deadair/plugin-sdk': patch
---

The fake plugin host's `remainingMs()` now starts where a live call does: a few milliseconds short of the host's 8 second default deadline, rather than at 15 seconds. A plugin that refuses work unless a full request timeout is left now fails its tests the way it fails on a station, instead of passing them while answering nothing live. A test that exercises a call the host gives a longer deadline (an enrichment call, a batch) seeds that deadline with `seedRemainingMs`.
