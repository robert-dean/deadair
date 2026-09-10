---
title: 'Get track'
sidebar_label: 'Get track'
sidebar_position: 11
mdx:
    format: 'md'
---

One record and everything it has accumulated: its copies, its bytes, its measurement, what it has aired

**`GET`** `/catalog/tracks/{id}`

:::note
SDK method: `getTrack`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [TrackDetail](../models/catalog/track-detail.md) object.
