---
'@deadair/api': minor
---

A connected app can now run any operation it found with `search_api` through `call_api`, as the person who connected it and with the same checks the operation's own route makes. It can ask for only the fields it needs, and an answer too long to return whole keeps as many whole records as fit and says how many there were. Every call is logged with the app's grant and whether it was refused.
