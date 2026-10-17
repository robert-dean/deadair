---
'@deadair/api': patch
---

A new setting, "How hard the production model thinks" (`llm.productionReasoning`), sets the reasoning effort for writing and re-drafting each turn of a production, the way `llm.breakReasoning` already does for breaks. It defaults to A little, which is what every turn asked for until now. On a model that thinks at length even then, every phone-in and co-host banter failed as "came back empty twice" because one turn ran out of time or room before it said anything. Not at all fixes that.
