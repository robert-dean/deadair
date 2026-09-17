---
title: 'Revert break artwork'
sidebar_label: 'Revert break artwork'
sidebar_position: 3
mdx:
    format: 'md'
---

Puts the picture this repository ships back. The shipped file is read at this moment rather than copied at install, so an upgrade that improved it is what comes back

**`DELETE`** `/art/breaks/{kind}`

:::note
SDK method: `revertBreakArtwork`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `kind`    | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [BreakArtworkList](../models/art/break-artwork-list.md) object.

`404 Not Found`
