---
title: 'Update pad set'
sidebar_label: 'Update pad set'
sidebar_position: 28
mdx:
    format: 'md'
---

Renames a set. The KEY moves with it, so every persona naming the old one stops finding it

**`PUT`** `/pads/sets/{id}`

:::note
SDK method: `updatePadSet`
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

Accepts a [PadSetWrite](../models/render/pad-set-write.md) object.

## Response

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.
