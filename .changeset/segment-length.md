---
'@deadair/api': patch
---

A spoken break now knows how long it is. Its length is taken from the analyzer's measurement of the audio, which already ran for the loudness and had its length thrown away. Talking up to the post fits a link by its length, so it had never talked one up. Anything else that reads a break's length (the audio cache's look-ahead, what the player shows) now gets a real figure instead of none.
