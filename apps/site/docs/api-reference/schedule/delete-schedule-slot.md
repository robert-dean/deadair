---
title: 'Delete schedule slot'
sidebar_label: 'Delete schedule slot'
sidebar_position: 6
mdx:
    format: 'md'
---

Removes a slot. Whatever is on air stays on until the next slot begins

**`DELETE`** `/schedule/{id}`

:::note
SDK method: `deleteScheduleSlot`
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

`200 OK` — Returns a [ScheduleSlotList](../models/schedule/schedule-slot-list.md) object.
