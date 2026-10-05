---
title: 'Set vocal markers'
sidebar_label: 'Set vocal markers'
sidebar_position: 15
mdx:
    format: 'md'
---

Correct where the singing starts and stops, over whatever the lyrics say

**`PUT`** `/catalog/tracks/{id}/vocal-markers`

:::note
SDK method: `setVocalMarkers`
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

Accepts a [VocalMarkersInput](../models/catalog/vocal-markers-input.md) object.

## Response

`200 OK` — Returns a [VocalMarkersDetail](../models/catalog/vocal-markers-detail.md) object.
