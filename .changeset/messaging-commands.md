---
'@deadair/plugin-sdk': patch
'@deadair/api': patch
---

A messaging plugin can be told the station's commands, through a new optional `commands()` on the capability, so a platform that lists commands in its own interface shows the station's. The station tells it each time it starts listening, including after a settings save.
