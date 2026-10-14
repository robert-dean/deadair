---
'@deadair/api': patch
---

Requests: a request is placed once at a time, and only while it is still waiting, so two attempts that overlap can no longer put its record into the running order twice.
