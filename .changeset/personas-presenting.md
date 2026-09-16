---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
---

The Personas page now says who is **On air now** rather than marking the station's own host and calling that the same thing. They differ whenever the broadcast on air names its own host: the character presenting the show writes every break, while the station's own host is the one who takes over when a broadcast names nobody. That card is now badged **Station's own** instead. `Persona` gains a readonly `presenting`, derived per request from the running order through the same precedence a break uses, so it can never drift from who is actually speaking; the desk's "Presented by" badge reads it instead of working the fallback out for itself. The stored flag is unchanged and still `active`.
