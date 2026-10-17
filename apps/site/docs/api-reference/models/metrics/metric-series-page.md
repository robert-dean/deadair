---
title: 'MetricSeriesPage'
sidebar_position: 5
mdx:
    format: 'md'
---

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type               | Required | Description                                                         |
| ------------ | ------------------ | -------- | ------------------------------------------------------------------- |
| `resolution` | `MetricResolution` | Yes      | The width the points were read at                                   |
| `from`       | `string`           | Yes      |                                                                     |
| `to`         | `string`           | Yes      |                                                                     |
| `series`     | `MetricSeries[]`   | Yes      | Empty when nothing was measured in the range, which is not an error |

</details>
