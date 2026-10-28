---
'@deadair/api': patch
---

A written break now keeps the stored facts it was handed, each with its source link and the quoted span that states it, and whether the station's own read-back found the host saying it (migration `0124_segment_facts`). The source is copied with the break, so it survives the fact being removed with its record. Provider lines, a break the station's own phrasings wrote, and a presenter who is never shown the notes keep nothing. A rewrite replaces the last write's sources.
