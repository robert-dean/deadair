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
| `total`    | `number`          | Yes      | The total number of items |
| `page`     | `number`          | No       | The page number           |
| `pageSize` | `number`          | No       | The page size             |
| `search`   | `string`          | No       |                           |
| `sort`     | `'asc' \| 'desc'` | No       | The sort order            |
| `sortBy`   | `CatalogSort`     | No       |                           |

</details>

## Response

`200 OK` — Returns a [AlbumPage](../models/catalog/album-page.md) object.
