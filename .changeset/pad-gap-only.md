---
'@deadair/api': patch
---

A pronunciation entry for a name that starts with punctuation (`?uestlove`, `.38 Special`) now matches. Taking a soundboard hit out of a script no longer closes every space in front of punctuation elsewhere in it, which had glued such names to the word before them, in the stored script as well as on the way to the engine.
