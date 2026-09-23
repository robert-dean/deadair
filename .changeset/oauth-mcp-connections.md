---
'@deadair/api': minor
---

The station can be an OAuth authorization server, so an app such as a Claude connector can connect to it as whoever approves it. Turn it on under Settings, Sign-in and connections, then point the app at your station's public address followed by /api/mcp. The app registers itself, sends you to the station to sign in and approve it, and gets a token that works at that address only. It can do what you can, and nothing more. The MCP endpoint offers no tools yet; this is the way in, and the tools come next. Everything stays off until you switch it on.
