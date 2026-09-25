---
title: 'PlayoutChartInput'
sidebar_position: 3
mdx:
    format: 'md'
---

> The published chart to build the running order from

<details>
<summary>Attributes (3)</summary>

| Attribute    | Type                                     | Required | Description                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chartId`    | `string`                                 | Yes      | As `pluginId:chartId`, which is how `GET /charts` lists them                                                                                                                                                                      |
| `chartOrder` | `'countdown' \| 'ranked' \| 'unordered'` | No       | Which way round to play it. Absent is `countdown`, which opens on the lowest rank and ends on number one                                                                                                                          |
| `callins`    | `boolean`                                | No       | Whether somebody phones in during this broadcast, exactly as `PutOnAirInput.callins`. Absent takes the station's own `rotation.callins`, so a station that takes calls needs an explicit `false` here to air a chart without them |

</details>
