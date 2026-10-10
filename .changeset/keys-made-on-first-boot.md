---
'@deadair/api': minor
---

The station makes its two keys itself. Leave `KMS_LOCAL_ROOT_KEY` and `AUTHENTICATION_SESSION_JWT_PRIVATE_KEY` unset and the first boot generates both into `secrets/` in the data directory, then reads them back from there on every boot after. Installing no longer starts with two `openssl` commands, and the Unraid template no longer requires either field. A key set in the environment still wins, and the station warns at boot when a root key in the environment differs from the one it made. Back up `secrets/` with the rest of the data directory: losing the root key means entering every stored credential again.
