---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

A production can be given notes: the facts it may state, one short note each. Given notes, a podcast says nothing as fact that the notes do not give, and each beat is handed only the notes it covers; left without, it talks from general knowledge and keeps the specifics vague, as before. The console's production form has a Notes box (one per line), and the list says how many notes a production was grounded in. In the API, `ProductionRequest` and `Production` carry an optional `notes` list.
