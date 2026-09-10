---
title: 'Rate artist'
sidebar_label: 'Rate artist'
sidebar_position: 5
mdx:
    format: 'md'
---

What the station thinks of this artist. A dislike here excludes every record they are credited on

**`PUT`** `/catalog/artists/{id}/rating`

:::note
SDK method: `rateArtist`
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

`200 OK` — Returns a [Artist](../models/catalog/artist.md) object.
