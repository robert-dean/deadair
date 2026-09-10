---
title: 'Get album'
sidebar_label: 'Get album'
sidebar_position: 7
mdx:
    format: 'md'
---

**`GET`** `/catalog/albums/{id}`

:::note
SDK method: `getAlbum`
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

`200 OK` — Returns a [Album](../models/catalog/album.md) object.
