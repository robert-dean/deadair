---
title: 'Read current slot'
sidebar_label: 'Read current slot'
sidebar_position: 3
mdx:
    format: 'md'
---

Which slot the clock says should be on, and which one the station is actually airing

**`GET`** `/schedule/current`

:::note
SDK method: `readCurrentSlot`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [ScheduleNow](../models/schedule/schedule-now.md) object.
