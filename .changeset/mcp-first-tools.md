---
'@deadair/api': minor
---

An app connected to the station over MCP, such as a Claude connector, now has tools to call: what is on air, what is queued behind it, and `whoami`, which says who the app is acting as and what time it is at the station. Each call runs as the person who approved the app, with their permissions, and a refusal reaches the model as a message it can act on rather than a failed call.
