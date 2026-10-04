---
title: 'Clear vocal markers'
sidebar_label: 'Clear vocal markers'
sidebar_position: 16
mdx:
    format: 'md'
---

Drop the correction, so the record's timed lyrics decide again

**`DELETE`** `/catalog/tracks/{id}/vocal-markers`

:::note
SDK method: `clearVocalMarkers`
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

`200 OK` — Returns a [VocalMarkersDetail](../models/catalog/vocal-markers-detail.md) object.
