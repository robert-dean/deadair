---
'@deadair/web': patch
---

Signing in to the console with a passkey, and answering a second step with one, now work. The console sent the signed passkey form-encoded, which flattened it to nothing the station could read, so both were refused.
