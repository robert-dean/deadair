---
title: 'Skip to a running order item'
sidebar_label: 'Skip to a running order item'
sidebar_position: 19
mdx:
    format: 'md'
---

Makes a record further down the running order the next thing heard. Everything still to come in front of it is marked skipped, anything the player was already holding from in front of it is taken back, and the item on air is cut. Only a record can be skipped to, and only one still to come

**`POST`** `/director/air/items/{itemId}/skip-to`

:::note
SDK method: `skipToARunningOrderItem`
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
