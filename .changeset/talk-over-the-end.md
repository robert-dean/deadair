---
'@deadair/api': minor
'@deadair/sdk': minor
---

Breaks: **Talk over the end of a record** (Settings, Breaks, off by default) says a link over the outro of the record before it when it fits between the last sung word and the record's measured end, finishing as the record finishes, and the next record starts straight after with no crossfade. It needs the record's timed lyrics and its measurement, and anything it cannot judge airs in the gap as before. A running-order item carries `overEndOf` when it rides the end of the record before it.
