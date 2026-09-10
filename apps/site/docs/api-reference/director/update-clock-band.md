---
title: 'Update clock band'
sidebar_label: 'Update clock band'
sidebar_position: 3
mdx:
    format: 'md'
---

Rewrites one band. Breaks it has already planted stay where they are: the running order is the memory

**`PUT`** `/clock/bands/{id}`

:::note
SDK method: `updateClockBand`
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

Accepts a [ClockBand](../models/director/clock-band.md) object.

## Response

`200 OK` — Returns a [ClockBandList](../models/director/clock-band-list.md) object.
