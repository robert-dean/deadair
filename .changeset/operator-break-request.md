---
'@deadair/api': minor
---

An operator can ask the station for a break now, rather than waiting for the format clock: `POST /director/air/breaks` takes a `kind` (`news`, `weather`, `almanac`, `talkbreak`, `story` or `jingle`), an `urgency` (`next` unless told otherwise) and an optional `topic`, such as a news category or a weather place. The station decides where the break goes. When it declines (breaks are off, it has no voice, or the same request went in under a minute ago) the answer gives its reason instead of failing. The same operation is in every SDK and is the `request_a_break` MCP tool.
