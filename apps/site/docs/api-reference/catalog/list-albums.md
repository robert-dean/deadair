---
title: 'List albums'
sidebar_label: 'List albums'
sidebar_position: 6
mdx:
    format: 'md'
---

**`GET`** `/catalog/albums`

:::note
SDK method: `listAlbums`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (6)</summary>

| Attribute  | Type              | Required | Description               |
| ---------- | ----------------- | -------- | ------------------------- |
| `page`     | `number`          | Yes      | The page number           |
| `pageSize` | `number`          | Yes      | The page size             |
| `sort`     | `'asc' \| 'desc'` | Yes      | The sort order            |
| `total`    | `number`          | Yes      | The total number of items |
| `search`   | `string`          | No       |                           |
| `sortBy`   | `CatalogSort`     | No       |                           |

</details>

## Response

`200 OK` — Returns a [AlbumPage](../models/catalog/album-page.md) object.
