---
'@deadair/api': patch
---

Stop signing out an app or a console session when it repeats a token refresh within thirty seconds, which clients sharing one connector can do by accident.
