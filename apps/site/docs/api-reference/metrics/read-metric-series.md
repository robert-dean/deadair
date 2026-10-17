---
title: 'Read metric series'
sidebar_label: 'Read metric series'
sidebar_position: 1
mdx:
    format: 'md'
---

Trends over a range, at minute resolution for two days or less and hourly beyond

**`GET`** `/metrics/series`

:::note
SDK method: `readMetricSeries`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                   |
| --------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `from`    | `string` | Yes      | The start of the range, inclusive                                             |
| `names`   | `string` | Yes      | Comma-separated metric names, at most twenty: `station.listeners,work.job.ms` |
| `to`      | `string` | Yes      | The end of the range, exclusive. At most four hundred days after `from`       |

</details>

## Response

`200 OK` — Returns a [MetricSeriesPage](../models/metrics/metric-series-page.md) object.
