---
'@deadair/api': patch
'@deadair/sdk': patch
---

`GET /stream/listeners` lists who is connected to the station's stream right now, one row per connection: the Icecast mount or HLS, the address, the player and how long it has been connected, with the station's own listener count beside it. Operators only, and not offered to MCP clients, since what it answers is listeners' addresses. Nothing about it is stored: Icecast is asked when the request arrives. A mount that could not be read is listed as such rather than as empty.
