---
title: 'List schedule'
sidebar_label: 'List schedule'
sidebar_position: 1
mdx:
    format: 'md'
---

Every slot in this station's schedule, earliest in the day first

**`GET`** `/schedule`

:::note
SDK method: `listSchedule`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [ScheduleSlotList](../models/schedule/schedule-slot-list.md) object.
