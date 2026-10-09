---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': minor
---

The host can say where a chart placed a record: "number seven on the Hot 100", with its highest position and its weeks on the chart where the chart gives them. It covers a chart aired whole (the countdown) and the records a chart adds to an ordinary rotation. It is a setting on the show rather than the presenter: a schedule slot, the Air this chart button and `PutOnAirInput` each take `chartPositions`, and leaving it unset means the positions are said. Untick "Say each record's chart position" to air a chart without them. Phrasings can use `{{next.chart.rank}}` and `{{next.chart.name}}` (and the `previous.` pair) to count down without a model.
