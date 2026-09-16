---
title: 'Render piece'
sidebar_label: 'Render piece'
sidebar_position: 3
mdx:
    format: 'md'
---

Has one piece spoken now, rather than waiting for its slot to come near

**`POST`** `/narrations/pieces/{id}/render`

:::note
SDK method: `renderPiece`
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

`200 OK` — Returns a [StationPiece](../models/narrations/station-piece.md) object.
