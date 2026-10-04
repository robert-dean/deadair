---
'@deadair/api': minor
---

Two new controls on Programme, under a new **Leans and rules** tab. **Never play** forbids a whole kind of record: a genre, which also covers any kind of it (a rule for Punk refuses Punk Rock, but a rule for Rap never refuses Trap), or an exact tag. A rule can hold only for a season or a window of hours, and while it holds it is absolute, like a dislike: no playlist, chart or listener request gets round it. **Lean toward** is the gentle version: for a few hours the station chooses the genres you name far more often, while still playing anything else rather than running dry. The API is `/rules` and `/rules/steer`.
