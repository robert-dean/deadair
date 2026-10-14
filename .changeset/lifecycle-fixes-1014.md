---
'@deadair/api': patch
---

Four fixes from the station's own log. Segments and pads measured at boot are no longer refused by the measurement sidecar, which used to see URLs signed before the bridge secret was loaded and failed the same files on every start. A listener closing the console mid-request no longer logs a 500 from the refresh-cookie step. Taking the queue back when nobody is listening no longer counts as the player failing to take a record, so three quiet spells can no longer skip a good one. And a break reopened for rewriting just before its turn is prepared again instead of being handed over with no audio and skipped.
