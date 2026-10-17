---
title: 'MetricSeries'
sidebar_position: 4
mdx:
    format: 'md'
---

> One metric and one set of labels, its points oldest first

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                     | Required | Description                                                                                                        |
| --------- | ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `name`    | `string`                 | Yes      |                                                                                                                    |
| `labels`  | `Record<string, string>` | Yes      | What tells this series from the metric's others: `{ "queue": "catalog.sync" }`. Empty for a metric with one series |
| `source`  | `string`                 | Yes      | `station` for what the station measured itself, `otlp` for what another service sent it                            |
| `points`  | `MetricPoint[]`          | Yes      | Only the buckets that hold something. A gap is a stretch nothing was measured, which a chart should draw as a gap  |

</details>
