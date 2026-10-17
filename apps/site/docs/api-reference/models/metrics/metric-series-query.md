---
title: 'MetricSeriesQuery'
sidebar_position: 2
mdx:
    format: 'md'
---

> The trends to read, over one range

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                   |
| --------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `names`   | `string` | Yes      | Comma-separated metric names, at most twenty: `station.listeners,work.job.ms` |
| `from`    | `string` | Yes      | The start of the range, inclusive                                             |
| `to`      | `string` | Yes      | The end of the range, exclusive. At most four hundred days after `from`       |

</details>
