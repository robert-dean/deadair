---
'@deadair/api': patch
---

A failed request now shows up in the station log with its method, its path (never the query string, which can carry a token), its status, and the request and correlation ids. Before this, a line like `Too Many Requests` didn't say which route was refused. Refusals that are the caller's fault (401, 403, 404, 409, 429) are logged as warnings rather than errors, so the errors in the log are the station's own faults.
