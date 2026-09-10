---
title: 'Move a running order item'
sidebar_label: 'Move a running order item'
sidebar_position: 17
mdx:
    format: 'md'
---

Moves an item. A position already handed to the player is refused rather than clamped

**`PATCH`** `/director/air/items/{itemId}`

:::note
SDK method: `moveARunningOrderItem`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `itemId`  | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [MoveStationItemInput](../models/director/move-station-item-input.md) object.

## Response

`200 OK` — Returns a [StationOrder](../models/director/station-order.md) object.
