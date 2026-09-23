---
'@deadair/api': patch
'@deadair/web': patch
'@deadair/sdk': patch
---

A character can now keep subjects apart, so that no break brings up two of them. In the persona editor, "Never in the same break" takes one subject per line, written as the words that mean it separated by commas (for example `bigfoot, sasquatch, yeti`). A break that uses words from two lines is refused, the model gets one retry, and after that the character's own fallback phrasings speak. Words match the way diction markers do, plurals included, and a word that only appears inside the title of a record the break names does not count. The words are shown to the model too, so it knows the rule it is being held to. News, weather and almanac bulletins are excused. The field is stored on the persona, is in the API and every SDK, and travels in persona export files. The conspiracy host's seed uses it, with one subject per theory.
