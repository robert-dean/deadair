---
'@deadair/api': patch
---

A break that needs the model no longer waits behind a search that has stopped answering. When the model was choosing records and one of its searches hung, the station kept waiting for that search even after a break had asked for the model back or the refill's time had run out, so the break gave up and was read from the plain fallback instead. The search is now abandoned the moment the model is taken back, no further searches are started, and the break gets the model straight away.
