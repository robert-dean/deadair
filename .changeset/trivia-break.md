---
'@deadair/api': minor
'@deadair/web': minor
---

A band on the format clock can now ask for `trivia`: one fact about the music the station plays, passed on between records. Every fact comes from what the station already knows about its records, each with the published passage that supports it, never from a model's memory. Only music the station has played is used, nothing the operator has disliked or suspended, and the same fact is not offered twice in a week. Without a model the station reads the fact out inside its own phrasings, which are under Voice, Phrasings as "How the station passes on a piece of trivia"; with one, the presenter picks one of six and says it in their own voice, and an answer naming a year the station was never given is declined.
