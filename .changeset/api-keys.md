---
'@deadair/api': minor
---

API keys, for a script or an integration that should reach the station without your password. Settings → Security has a new card to create one, read-only or read-and-manage, with an expiry if you want one; the key is shown once, and can be rotated or revoked from the same card. A key acts as your account and never does more than it can, so a listener's key only reads. It cannot sign in, change how you sign in, or make other keys. Send it as `Authorization: Bearer da_…`.
