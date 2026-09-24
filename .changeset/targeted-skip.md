---
'@deadair/api': patch
---

A skip no longer cuts the wrong record. When a record ended on its own just as Skip was pressed, the cut used to land on the record after it. The same could happen when skipping to a record further down the order, when taking off a record the station was told not to play, and when a scheduled programme cut a record that had overrun. Each of these now cuts only the record that was on air when it was asked for, and cuts nothing if that record has already ended.
