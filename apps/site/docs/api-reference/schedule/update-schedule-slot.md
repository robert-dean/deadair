---
title: 'Update schedule slot'
sidebar_label: 'Update schedule slot'
sidebar_position: 5
mdx:
    format: 'md'
---

Rewrites a slot. Takes effect at its next boundary rather than immediately

**`PUT`** `/schedule/{id}`

:::note
SDK method: `updateScheduleSlot`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [ScheduleSlot](../models/schedule/schedule-slot.md) object.

## Response

`200 OK` — Returns a [ScheduleSlotList](../models/schedule/schedule-slot-list.md) object.
