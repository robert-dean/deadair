---
'@deadair/api': patch
---

A library of more than 10,000 tracks now syncs in full. The catalog sync used to stop at the first 10,000 tracks a provider handed over, which for Navidrome is the start of the alphabet, so a large library only ever played records starting with a digit, an A or a B. A provider that keeps serving the same page is now caught on its second page and logged, rather than read two hundred times.
