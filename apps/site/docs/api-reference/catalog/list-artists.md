---
title: 'List artists'
sidebar_label: 'List artists'
sidebar_position: 1
mdx:
    format: 'md'
---

Every artist the station has ingested, ordered by name

**`GET`** `/catalog/artists`

:::note
SDK method: `listArtists`
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

`200 OK` — Returns a [ArtistPage](../models/catalog/artist-page.md) object.
