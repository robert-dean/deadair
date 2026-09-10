---
title: 'Delete segment'
sidebar_label: 'Delete segment'
sidebar_position: 12
mdx:
    format: 'md'
---

Removes a recording and the inbox file behind it, so the next scan does not read it back in

**`DELETE`** `/segments/{id}`

:::note
SDK method: `deleteSegment`
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

`200 OK` — Returns a [SegmentList](../models/render/segment-list.md) object.

`404 Not Found`

`409 Conflict`
