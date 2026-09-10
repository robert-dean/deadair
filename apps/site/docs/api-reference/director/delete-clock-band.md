---
title: 'Delete clock band'
sidebar_label: 'Delete clock band'
sidebar_position: 4
mdx:
    format: 'md'
---

Removes a band, which costs it the boundaries it had not claimed yet and nothing else

**`DELETE`** `/clock/bands/{id}`

:::note
SDK method: `deleteClockBand`
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

`200 OK` — Returns a [ClockBandList](../models/director/clock-band-list.md) object.
