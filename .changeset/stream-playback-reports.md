---
"@deadair/plugin-sdk": minor
"@deadair/api": minor
---

Plugins: a stream provider can now implement the optional `reportPlayback(trackId, report)` to hear when one of its records goes to air (`started`) and when the next item takes over (`ended`, with the time heard). The station sends these as background jobs off the moment each record airs, and only to providers that implement it, for services that expect the client that fetched a record to say it is being played.
