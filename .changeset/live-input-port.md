---
'@deadair/api': patch
---

The image now publishes a second port, 8006, for the live input, where a presenter's encoder connects to take the air. On Unraid it appears as **Live input** in the template, and the Docker Compose install maps it with `LIVE_PORT`. Nothing on the port airs until the station arms it, and nothing arms it yet.
