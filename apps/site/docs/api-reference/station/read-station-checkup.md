---
title: 'Read station checkup'
sidebar_label: 'Read station checkup'
sidebar_position: 5
mdx:
    format: 'md'
---

The loops the station runs and how much of the library it has looked at

**`GET`** `/station/checkup`

:::note
SDK method: `readStationCheckup`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationCheckup](../models/station/station-checkup.md) object.
