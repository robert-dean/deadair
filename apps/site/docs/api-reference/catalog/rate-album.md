---
title: 'Rate album'
sidebar_label: 'Rate album'
sidebar_position: 10
mdx:
    format: 'md'
---

What the station thinks of this record. A dislike here excludes every track on it

**`PUT`** `/catalog/albums/{id}/rating`

:::note
SDK method: `rateAlbum`
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

`200 OK` — Returns a [Album](../models/catalog/album.md) object.
