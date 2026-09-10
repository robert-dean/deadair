---
title: 'StationChart'
sidebar_position: 1
mdx:
    format: 'md'
---

> A chart one installed plugin offers

<details>
<summary>Attributes (6)</summary>

| Attribute     | Type     | Required | Description                                                                                                                                                          |
| ------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string` | Yes      | Unique across the station: the plugin's own id for the chart, qualified with the plugin that offered it. Two services both calling something `top-100` stay distinct |
| `pluginId`    | `string` | Yes      |                                                                                                                                                                      |
| `name`        | `string` | Yes      |                                                                                                                                                                      |
| `country`     | `string` | No       | ISO 3166-1 alpha-2, when the chart is national. Absent means global                                                                                                  |
| `genre`       | `string` | No       |                                                                                                                                                                      |
| `description` | `string` | No       |                                                                                                                                                                      |

</details>
