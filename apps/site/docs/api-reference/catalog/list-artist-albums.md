---
title: 'List artist albums'
sidebar_label: 'List artist albums'
sidebar_position: 4
mdx:
    format: 'md'
---

The albums credited to one artist

**`GET`** `/catalog/artists/{id}/albums`

:::note
SDK method: `listArtistAlbums`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (7)</summary>

| Attribute  | Type              | Required | Description               |
| ---------- | ----------------- | -------- | ------------------------- |
| `id`       | `string`          | Yes      | Path parameter.           |
| `page`     | `number`          | Yes      | The page number           |
| `pageSize` | `number`          | Yes      | The page size             |
| `sort`     | `'asc' \| 'desc'` | Yes      | The sort order            |
| `total`    | `number`          | Yes      | The total number of items |
| `search`   | `string`          | No       |                           |
| `sortBy`   | `CatalogSort`     | No       |                           |

</details>

## Response

`200 OK` — Returns a [AlbumPage](../models/catalog/album-page.md) object.
