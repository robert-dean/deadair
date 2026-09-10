---
title: 'Remove a running order item'
sidebar_label: 'Remove a running order item'
sidebar_position: 18
mdx:
    format: 'md'
---

Drops an item that has not been handed to the player yet

**`DELETE`** `/director/air/items/{itemId}`

:::note
SDK method: `removeARunningOrderItem`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `itemId`  | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [StationOrder](../models/director/station-order.md) object.
