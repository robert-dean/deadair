---
title: 'Update event destination'
sidebar_label: 'Update event destination'
sidebar_position: 4
mdx:
    format: 'md'
---

Change an event destination's name, address, or whether it is on

**`PATCH`** `/events/destinations/{id}`

:::note
SDK method: `updateEventDestination`
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

Accepts a [EventDestinationUpdate](../models/events/event-destination-update.md) object.

## Response

`200 OK` — Returns a [EventDestination](../models/events/event-destination.md) object.
