---
title: 'PlayoutChartInput'
sidebar_position: 4
mdx:
    format: 'md'
---

> The published chart to build the running order from

<details>
<summary>Attributes (4)</summary>

| Attribute        | Type                                     | Required | Description                                                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chartId`        | `string`                                 | Yes      | As `pluginId:chartId`, which is how `GET /charts` lists them                                                                                                                                                                                   |
| `chartOrder`     | `'countdown' \| 'ranked' \| 'unordered'` | No       | Which way round to play it. Absent is `countdown`, which opens on the lowest rank and ends on number one                                                                                                                                       |
| `chartPositions` | `boolean`                                | No       | Whether the host says where the chart placed each record it named: "number seven on the Hot 100". Absent is yes. Set it false to air a chart without its positions read out. A record no chart named has no position to say whatever this says |
| `callins`        | `boolean`                                | No       | Whether somebody phones in during this broadcast, exactly as `PutOnAirInput.callins`. Absent is no calls: there is no station-wide default behind it                                                                                           |

</details>
