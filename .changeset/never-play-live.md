---
'@deadair/api': minor
'@deadair/sdk': minor
---

A never-play rule can refuse live recordings: `field: version` with `value: live`. It reads the version markers on a record's title and album ("War Pigs - Live", anything from "Live in Nottingham"), never the word wherever it appears, so "Live Wire" and "Live And Let Die" still play. Like every never-play rule it is absolute, and can hold only for some schedule blocks, hours, seasons or modes.
