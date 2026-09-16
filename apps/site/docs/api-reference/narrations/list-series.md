---
title: 'List series'
sidebar_label: 'List series'
sidebar_position: 1
mdx:
    format: 'md'
---

Every series every installed narration plugin offers

**`GET`** `/narrations/series`

:::note
SDK method: `listSeries`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationSeriesList](../models/narrations/station-series-list.md) object.
