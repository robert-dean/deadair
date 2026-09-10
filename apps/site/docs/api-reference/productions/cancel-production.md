---
title: 'Cancel production'
sidebar_label: 'Cancel production'
sidebar_position: 3
mdx:
    format: 'md'
---

Stops a production being made, for good

**`POST`** `/productions/{id}/cancel`

:::note
SDK method: `cancelProduction`
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

`200 OK` — Returns a [Production](../models/productions/production.md) object.
