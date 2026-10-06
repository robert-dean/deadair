---
'@deadair/api': minor
---

A speech preview can now play a soundboard hit. `POST /voices/preview` takes an optional `soundboard`, and when the text contains `[sfx:name]` for a pad on that board, the preview is spoken around the pad and mixed exactly as the break would be on air, at the same level and in the same place. If the board does not hold the pad, or no mixer is installed, you hear the words alone as before. Replacing a pad or changing a pad level setting makes a fresh preview instead of replaying the old one.
