---
title: 'List event deliveries'
sidebar_label: 'List event deliveries'
sidebar_position: 8
mdx:
    format: 'md'
---

A destination's latest delivery attempts, newest first

**`GET`** `/events/destinations/{id}/deliveries`

:::note
SDK method: `listEventDeliveries`
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

`200 OK` — Returns a [EventDeliveryList](../models/events/event-delivery-list.md) object.
