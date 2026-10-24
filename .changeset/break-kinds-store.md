---
'@deadair/api': minor
'@deadair/sdk': minor
---

The station can hold kinds of break you write yourself: a name, a brief in your own words saying what the break is for, any rules of its own on top of the ones every break follows, and what the presenter is shown while writing one. On the API: `GET` and `POST /breaks/kinds`, and `PUT` and `DELETE /breaks/kinds/{id}`. A new kind is switched off until you switch it on, its key cannot change once written, a key the station already uses for its own breaks is refused, and a kind a band on the format clock still names cannot be deleted. Nothing writes these breaks yet.
