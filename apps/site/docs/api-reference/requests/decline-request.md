---
title: 'Decline request'
sidebar_label: 'Decline request'
sidebar_position: 6
mdx:
    format: 'md'
---

Turn a request down. One already in the running order is left there; take it out of the order instead

**`POST`** `/requests/{id}/decline`

:::note
SDK method: `declineRequest`
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

Accepts a [ListenerRequestDecline](../models/requests/listener-request-decline.md) object.

## Response

`200 OK` — Returns a [ListenerRequest](../models/requests/listener-request.md) object.
