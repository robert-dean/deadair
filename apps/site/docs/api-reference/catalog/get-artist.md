---
title: 'Get artist'
sidebar_label: 'Get artist'
sidebar_position: 2
mdx:
    format: 'md'
---

One artist. 404s on an id that was merged away, since reads never return merged rows

**`GET`** `/catalog/artists/{id}`

:::note
SDK method: `getArtist`
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

`200 OK` — Returns a [Artist](../models/catalog/artist.md) object.
