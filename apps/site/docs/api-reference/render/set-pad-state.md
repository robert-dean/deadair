---
title: 'Set pad state'
sidebar_label: 'Set pad state'
sidebar_position: 25
mdx:
    format: 'md'
---

Turns a sound down, or puts one back. Answers the whole rack, since one pad changing state is one row moving between two sections of the same page

**`PUT`** `/pads/{id}/state`

:::note
SDK method: `setPadState`
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

Accepts a [PadState](../models/render/pad-state.md) object.

## Response

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.
