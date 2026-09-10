---
title: 'ChartPage'
sidebar_position: 5
mdx:
    format: 'md'
---

<details>
<summary>Attributes (2)</summary>

| Attribute | Type            | Required | Description                                                                                                                                                   |
| --------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chartId` | `string`        | Yes      |                                                                                                                                                               |
| `records` | `ChartRecord[]` | Yes      | Ranked. Empty when the chart could not be read, which is deliberately not an error: a chart is something to look at, never something the station needs to air |

</details>
