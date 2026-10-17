---
title: 'Read metric names'
sidebar_label: 'Read metric names'
sidebar_position: 2
mdx:
    format: 'md'
---

Every metric the station holds, with its labels and when it was last measured

**`GET`** `/metrics/names`

:::note
SDK method: `readMetricNames`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [MetricNames](../models/metrics/metric-names.md) object.
