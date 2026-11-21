---
'@deadair/api': patch
---

Presenters in a production now remember what they said on air in the last hour, so a catchphrase they have already used stays spent in the next production. Until now that lookup failed every time and left "productions: could not read what a speaker said lately" in the station log, so productions were written without it.
