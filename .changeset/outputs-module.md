---
'@deadair/api': minor
'@deadair/sdk': minor
---

The station can be put on a speaker from the API: `GET /outputs/devices` lists every speaker an `output` plugin offers, with the station's mounts each one can play, and `POST /outputs/casts` starts one. The station keeps it playing through a dropped stream or a restart until `DELETE /outputs/casts/{pluginId}/{deviceId}` stops it, or somebody at the speaker plays something else. Speakers are handed the station's public address, so `stream.publicUrl` has to be one they can reach.
