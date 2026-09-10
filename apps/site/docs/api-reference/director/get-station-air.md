---
title: 'Get station air'
sidebar_label: 'Get station air'
sidebar_position: 5
mdx:
    format: 'md'
---

What the station is airing, and whether it is driving at all

**`GET`** `/director/air`

:::note
SDK method: `getStationAir`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationAir](../models/director/station-air.md) object.
