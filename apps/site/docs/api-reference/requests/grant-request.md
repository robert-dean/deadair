---
title: 'Grant request'
sidebar_label: 'Grant request'
sidebar_position: 5
mdx:
    format: 'md'
---

Let a waiting request through. It goes into the running order once its audio is here

**`POST`** `/requests/{id}/grant`

:::note
SDK method: `grantRequest`
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

`200 OK` — Returns a [ListenerRequest](../models/requests/listener-request.md) object.
