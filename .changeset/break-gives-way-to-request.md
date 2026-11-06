---
'@deadair/api': patch
---

Say when a listener request takes a break's place, and stop writing that break again. The break that made way was dropped with no trace beyond the request being placed, and the station then had the model write it again and spoke it again for a slot it would never air in. The station now logs it and reports it in the activity feed, and only breaks that can still air are rewritten.
