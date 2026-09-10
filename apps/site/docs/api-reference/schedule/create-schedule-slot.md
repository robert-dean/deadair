---
title: 'Create schedule slot'
sidebar_label: 'Create schedule slot'
sidebar_position: 2
mdx:
    format: 'md'
---

Adds a slot. The station does not change over until its start time comes round

**`POST`** `/schedule`

:::note
SDK method: `createScheduleSlot`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [ScheduleSlot](../models/schedule/schedule-slot.md) object.

## Response

`201 Created` — Returns a [ScheduleSlotList](../models/schedule/schedule-slot-list.md) object.
