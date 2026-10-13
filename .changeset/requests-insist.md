---
'@deadair/api': minor
'@deadair/sdk': minor
---

A listener can overrule the station on a request it turned down for its own taste. When a request is refused because the record aired lately, its artist played too recently, it is disliked, it falls outside the show's period or it is longer or shorter than the station plays, the request comes back `overrulable`, and `POST /requests/{id}/insist` asks for it again past those rules. The new request is decided like any other: one at a time, the cooldown, the line and operator approval all still apply, and each refusal can be insisted on once. A never-play rule, a clean-only station with no clean copy, and a record no source can play are never overruled, and those refusals now say so plainly rather than blaming the rotation. The MCP endpoint offers it as `insist_on_request`.
