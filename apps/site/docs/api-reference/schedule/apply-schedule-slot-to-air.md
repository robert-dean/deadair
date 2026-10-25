---
title: 'Apply schedule slot to air'
sidebar_label: 'Apply schedule slot to air'
sidebar_position: 7
mdx:
    format: 'md'
---

Applies a slot, as it is saved now, to the show on air, which must be that slot's. Its name, brief, period, moods, rules and host change in place and the broadcast carries on; the records still planned are chosen again against the new programme, and the ones already planned keep playing until the new set is ready. A change to its source, mode, end or co-hosts cannot be made mid-show and waits for the slot's next occurrence

**`POST`** `/schedule/{id}/apply`

:::note
SDK method: `applyScheduleSlotToAir`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [ScheduleSlotApplied](../models/schedule/schedule-slot-applied.md) object.

`404 Not Found`

`409 Conflict`
