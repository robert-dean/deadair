---
title: 'Update break kind'
sidebar_label: 'Update break kind'
sidebar_position: 3
mdx:
    format: 'md'
---

Rewrites one kind of break. Its key cannot change. A break already written keeps the words it was given

**`PUT`** `/breaks/kinds/{id}`

:::note
SDK method: `updateBreakKind`
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

Accepts a [BreakKind](../models/director/break-kind.md) object.

## Response

`200 OK` — Returns a [BreakKindList](../models/director/break-kind-list.md) object.
