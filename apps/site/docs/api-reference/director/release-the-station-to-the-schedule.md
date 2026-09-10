---
title: 'Release the station to the schedule'
sidebar_label: 'Release the station to the schedule'
sidebar_position: 13
mdx:
    format: 'md'
---

Releases a hold, so the next block boundary changes the station over as it ordinarily would. A station with no hold is unchanged rather than refused

**`DELETE`** `/director/air/hold`

:::note
SDK method: `releaseTheStationToTheSchedule`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [StationAir](../models/director/station-air.md) object.
