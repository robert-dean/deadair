---
title: 'Delete break kind'
sidebar_label: 'Delete break kind'
sidebar_position: 4
mdx:
    format: 'md'
---

Removes a kind of break. Refused while a band on the format clock still names it

**`DELETE`** `/breaks/kinds/{id}`

:::note
SDK method: `deleteBreakKind`
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

`200 OK` — Returns a [BreakKindList](../models/director/break-kind-list.md) object.
