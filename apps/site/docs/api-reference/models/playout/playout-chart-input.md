---
title: 'PlayoutChartInput'
sidebar_position: 2
mdx:
    format: 'md'
---

> The published chart to build the running order from

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type                                     | Required | Description                                                                                              |
| ------------ | ---------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `chartId`    | `string`                                 | Yes      | As `pluginId:chartId`, which is how `GET /charts` lists them                                             |
| `chartOrder` | `'countdown' \| 'ranked' \| 'unordered'` | No       | Which way round to play it. Absent is `countdown`, which opens on the lowest rank and ends on number one |

</details>
