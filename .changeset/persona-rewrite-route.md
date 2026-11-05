---
'@deadair/api': minor
'@deadair/sdk': minor
---

Add `POST /personas/{id}/rewrite`, which rewrites a character's speech rules, sample lines, signature words, catchphrases, banned wording and phrasings in the station's language and hands the sheet back unsaved, the way generating a character does. A character already in the station's language is refused with a 409.
