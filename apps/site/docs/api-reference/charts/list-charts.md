---
title: 'List charts'
sidebar_label: 'List charts'
sidebar_position: 1
mdx:
    format: 'md'
---

Every chart every installed chart plugin currently offers

**`GET`** `/charts`

:::note
SDK method: `listCharts`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationChartList](../models/charts/station-chart-list.md) object.
