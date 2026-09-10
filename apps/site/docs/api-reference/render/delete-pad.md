---
title: 'Delete pad'
sidebar_label: 'Delete pad'
sidebar_position: 24
mdx:
    format: 'md'
---

Removes a sound the console put there, and the file it wrote for it

**`DELETE`** `/pads/{id}`

:::note
SDK method: `deletePad`
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

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.

`404 Not Found`

`409 Conflict`
