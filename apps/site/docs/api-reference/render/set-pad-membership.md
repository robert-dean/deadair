---
title: 'Set pad membership'
sidebar_label: 'Set pad membership'
sidebar_position: 30
mdx:
    format: 'md'
---

Puts a pad on a set or takes it off. Refused where the set already answers to that name, because a script writes a name

**`PUT`** `/pads/sets/{id}/pads`

:::note
SDK method: `setPadMembership`
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

Accepts a [PadSetMembership](../models/render/pad-set-membership.md) object.

## Response

`200 OK` — Returns a [PadList](../models/render/pad-list.md) object.
