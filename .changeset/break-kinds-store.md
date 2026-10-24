---
'@deadair/api': minor
'@deadair/sdk': minor
---

The station can hold kinds of break you write yourself: a name, a brief in your own words saying what the break is for, any rules of its own on top of the ones every break follows, and what the presenter is shown while writing one. On the API: `GET` and `POST /breaks/kinds`, and `PUT` and `DELETE /breaks/kinds/{id}`. A new kind is switched off until you switch it on, its key cannot change once written, a key the station already uses for its own breaks is refused, and a kind a band on the format clock still names cannot be deleted. Once a kind is switched on and a band on the format clock names it, the station's model writes it in the voice of whoever is presenting, under the same rules as every other break: a kind's own rules are added to those, never in place of them. A kind needs the model to write it, so while the model writer is off the station does not offer it on the clock or plant it.
