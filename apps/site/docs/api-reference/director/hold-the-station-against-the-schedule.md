---
title: 'Hold the station against the schedule'
sidebar_label: 'Hold the station against the schedule'
sidebar_position: 12
mdx:
    format: 'md'
---

Holds the running order against the schedule, so a block boundary does not take back what an operator put on. A takeover is otherwise stamped with whichever slot was in force and is replaced when that block ends, which is correct and gives nobody any warning

**`PATCH`** `/director/air/hold`

:::note
SDK method: `holdTheStationAgainstTheSchedule`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [HoldStationInput](../models/director/hold-station-input.md) object.

## Response

`200 OK` — Returns a [StationAir](../models/director/station-air.md) object.
