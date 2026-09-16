---
'@deadair/api': minor
---

A break the model nearly got right is now put back to it once, rather than going straight to the station's fallback phrasings. When a script is refused for something the model can act on — it did not sound like the character, it used wording the persona forbids, it reached for a signature just used, it read a sample line back, it named the wrong part of the day, or it answered with nothing — the same writer is asked again, told which rule it broke and shown what was refused. Refusals about the records themselves (a break about neither of them, a record announced on the wrong side, an invented year) are not retried: those mean the model misread what it was given, and asking again invites it to invent something that fits. The second ask waits only as long as the break's own deadline allows, so it can never make the station late, and both attempts are recorded, so the refusal and the rewrite are both in the history.
