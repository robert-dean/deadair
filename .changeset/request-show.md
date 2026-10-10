---
'@deadair/api': minor
---

A broadcast can be a request show. Put the station on air with `requestShow` and it plays as it otherwise would until a listener's request goes in, then replaces what it had planned after the request with records that sound like it, four by default or as many as `requestFollowOn` asks for, up to ten. A second request waits for the first one's records to play out, then gets its own. It needs a similarity plugin that can name records, and the activity feed says so when there is none. The running order now says when it is a request show and which records followed a request.
