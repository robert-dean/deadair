---
'@deadair/plugin-sdk': minor
'@deadair/plugin-lrclib': minor
'@deadair/api': patch
---

A timed lyric line can now carry the timing of each word in it. `LyricLine` gains an optional `words` (each piece's start and its text, joining back to the line exactly), the LRCLIB plugin reads enhanced LRC's per-word tags into it instead of throwing them away, and the station stores them beside the line, dropping a line's words whole when they do not add up.
