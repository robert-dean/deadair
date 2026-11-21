---
'@deadair/api': patch
---

A listener or console page that disconnects while the station is still checking who is asking (a tab closed, a page left before it finished loading, a poll replaced by a newer one) no longer leaves a "Cannot resolve from a disposed container" error and a 500 in the station's log. Nobody is waiting for the answer by then, so the request is dropped quietly.
