---
'@deadair/api': patch
---

A setlist whose broadcast turns breaks on now actually talks. It takes the station's own spacing for talk breaks and jingles, and greets a new listener and marks a change of programme as the station does, where before the spacing stayed at zero and the switch turned nothing on. Everything about the records stays as a setlist has it: nothing is cut by a cooldown or a cap, nothing is generated or mixed in, and nobody rings in unless the broadcast asks for that too. A setlist that says nothing about breaks is silent exactly as before, and a feature stays silent whatever it asks. This is the first step towards a chart countdown with a host; a scheduled slot cannot ask for it yet.
