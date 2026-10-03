---
'@deadair/api': minor
---

"Start shows on time" now fades the record out instead of cutting it. When a record from the last show is still playing past the limit you set, it fades away over four seconds by default, and the new show starts at full level. The fade length is a new setting beside the limit on the Programme page, under At a boundary; zero cuts the record at once, the way Skip does. The cut is aimed at that one record, so if it ends on its own partway through the fade, the fade stops and nothing else is touched.
