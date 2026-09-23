---
'@deadair/api': patch
---

A character can now keep certain subjects apart: a break that brings up two of them is refused, the model gets one retry, and after that the character's own fallback phrasings speak. Each subject is a list of words that mean it, matched the way diction markers are, and a word that only appears inside a record's title does not count. The words are also shown to the model, so it knows the rule it is being held to. News, weather and almanac bulletins are excused. Nothing sets this yet; the field reaches the database and the console in the next changes.
