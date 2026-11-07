---
title: 'Scope segment'
sidebar_label: 'Scope segment'
sidebar_position: 14
mdx:
    format: 'md'
---

Sets which shows and presenters a recording is for. An empty scope makes it a recording for every show

**`PUT`** `/segments/{id}/scope`

:::note
SDK method: `scopeSegment`
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

Accepts a [SegmentScope](../models/render/segment-scope.md) object.

## Response

`200 OK` — Returns a [Segment](../models/render/segment.md) object.

`400 Bad Request`

`404 Not Found`

`409 Conflict`
