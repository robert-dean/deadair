---
'@deadair/api': minor
---

An app connected over MCP (Claude, say) now gets the names it most likely meant when it asks for an operation that does not exist, so a near miss like `list_album` costs it one corrected call rather than a fresh search. It also suggests only what the connection is allowed to use. `call_api` can now run up to five reads in one call, under `calls`, so a question like "what's on, what's next and what's queued" no longer takes a round trip for each part. A batch with anything that changes the station in it is refused before any of it runs, so every change is still confirmed on its own.
