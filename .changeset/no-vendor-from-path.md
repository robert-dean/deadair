---
'@deadair/api': patch
---

An unauthenticated request under `/webhooks/` is no longer treated as a fully trusted vendor. Nothing verifies a vendor's signature yet, so a vendor actor is now denied everything instead of granted it.
