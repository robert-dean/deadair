---
'@deadair/api': minor
---

Any client can now ask for a small copy of a talk break to send on by text message: `GET /segments/{id}/audio?rendition=share` answers AAC in an `.m4a`, mono at 64 kbps, so a minute is about half a megabyte where the rendered wav is three. The station makes the copy once, through the new `transcode` provider (the bundled audio analyzer), keeps it in its own directory (`SEGMENT_SHARE_DIR`, `media/share-copies` in the container) and sweeps it nightly once nobody has asked for it in "Keep copies listeners share for" (`render.shareCopyDays`, seven days by default; there is no setting that keeps them forever). Without the query the route answers exactly what it always did. A station with nothing that can make a copy answers 503 to the request and nothing else changes. Every SDK's `getSegmentAudio` takes the optional `rendition`.
