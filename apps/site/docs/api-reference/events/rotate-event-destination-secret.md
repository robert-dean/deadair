---
title: 'Rotate event destination secret'
sidebar_label: 'Rotate event destination secret'
sidebar_position: 6
mdx:
    format: 'md'
---

Make a new signing secret for a destination. The old one stops working at once

**`POST`** `/events/destinations/{id}/secret`

:::note
SDK method: `rotateEventDestinationSecret`
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

`200 OK` — Returns a [EventDestinationSecret](../models/events/event-destination-secret.md) object.
