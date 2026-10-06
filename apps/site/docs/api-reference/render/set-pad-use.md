---
title: 'Set pad use'
sidebar_label: 'Set pad use'
sidebar_position: 26
mdx:
    format: 'md'
---

Says where in a break a sound may land and when to reach for it. Answers the whole rack

**`PUT`** `/pads/{id}/use`

:::note
SDK method: `setPadUse`
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

Accepts a [PadUse](../models/render/pad-use.md) object.

## Response

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.
