---
'@deadair/plugin-sdk': patch
'@deadair/api': patch
'@deadair/plugin-musicbrainz': patch
---

A batch enrichment answer can now say a ref was not answered. `enrichTracks` entries may be `unanswered(reason)`, which the station files as a failure and asks again within the hour, where `{}` still means "not found" and is believed for a week. MusicBrainz uses it for a track whose lookup failed or that the call ran out of time to reach, so an upstream blip no longer holds a record's details back for seven days. Its album lookup now fails, rather than answering without the label and cover for ninety days, when the release request for the label fails.
