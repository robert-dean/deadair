---
'@deadair/api': minor
---

An app connected over MCP now works under the same view/manage limit as an API key, read from the scopes its grant holds. Every app already connected keeps both, so nothing it could do before stops working. A connected app can no longer pass a step-up check, approve another app or manage sign-in credentials, and whoami reports what the grant allows rather than the scope the app asked for.
