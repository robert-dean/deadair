---
title: 'Delete pad set'
sidebar_label: 'Delete pad set'
sidebar_position: 29
mdx:
    format: 'md'
---

Removes a set and its memberships, and no pads at all

**`DELETE`** `/pads/sets/{id}`

:::note
SDK method: `deletePadSet`
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
