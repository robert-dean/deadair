---
title: 'ScheduleTimetable'
sidebar_position: 4
mdx:
    format: 'md'
---

> The station's day as blocks, ready to draw

<details>
<summary>Attributes (3)</summary>

| Attribute     | Type                   | Required | Description                                                                                                                                  |
| ------------- | ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`        | `string`               | Yes      | The range actually drawn, echoed so a caller steps forward and back by adding days to a string rather than by knowing the station's timezone |
| `days`        | `number`               | Yes      |                                                                                                                                              |
| `occurrences` | `ScheduleOccurrence[]` | Yes      |                                                                                                                                              |

</details>
