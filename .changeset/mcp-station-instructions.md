---
'@deadair/api': patch
---

A connected app is told what the station is and where everything is. The MCP endpoint now sends instructions when Claude or another app connects: how its tools fit together, that settings can be read but not changed, and which operation does what, from the running order and requests to the format clock, news editions, kinds of break, going live and recordings. A new `help` tool answers the same text with the list of tools, for an app that ignores instructions.
