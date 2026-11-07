---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

A recording in the library (an ident, a jingle, a sponsor spot) can be scoped to shows, to presenters, or to both. A show draws its own recordings ahead of the station-wide ones and never airs another show's, and a recording scoped to a presenter follows them onto any show. Recordings with no scope air on every show, as they always have. Scope one from the Segments page, or with `PUT /segments/{id}/scope`.
