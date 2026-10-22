---
'@deadair/api': patch
---

A numeric setting left blank, or holding only spaces, now takes its default. It used to read as zero, so clearing a field in the console could set a length, a count or a timeout to nothing instead of putting it back.
