---
"@deadair/api": minor
"@deadair/plugin-sdk": minor
"@deadair/plugin-apple-music": minor
---

Apple Music: a catalog plugin that searches Apple Music with no developer key, and `stream/apple-player`, a container that plays a record in Apple's own web player and serves the capture over the same signed `GET /track/{id}` contract the Spotify shim answers. The plugin host gains `trackFetcher.servePlayer`, a provider may ask for a longer fetch budget for audio that arrives in real time, and the director no longer chooses a binding to deliver a record when its plugin cannot produce audio.
