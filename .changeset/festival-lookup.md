---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
'@deadair/plugin-sdk': minor
'@deadair/plugin-ticketmaster': minor
---

A festival can be looked up by name before it is added. A concert plugin may now list festivals (`findFestivals`, optional), the bundled Ticketmaster plugin does, `GET /festivals/lookup` asks every plugin that can, and the console's festival form has a "Look it up" box that fills the form from a listing. The festival is kept as the operator saves it, with where it came from noted and never read again.
