---
title: 'Rate track'
sidebar_label: 'Rate track'
sidebar_position: 19
mdx:
    format: 'md'
---

What the station thinks of this song, which is the narrowest thing an opinion can be about

**`PUT`** `/catalog/tracks/{id}/rating`

:::note
SDK method: `rateTrack`
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

Accepts a [RateInput](../models/catalog/rate-input.md) object.

## Response

`200 OK` — Returns a [Track](../models/catalog/track.md) object.
