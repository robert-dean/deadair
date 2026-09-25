---
'@deadair/api': patch
'@deadair/web': patch
---

What plays between schedule blocks has its own "take calls" switch on the schedule page, rather than following the station-wide one. A station that took calls keeps doing so between blocks, and a block that never said whether it takes calls is marked as taking them, so nothing changes on air when the station-wide switch goes away.
