---
title: 'List album tracks'
sidebar_label: 'List album tracks'
sidebar_position: 9
mdx:
    format: 'md'
---

One album's tracks

**`GET`** `/catalog/albums/{id}/tracks`

:::note
SDK method: `listAlbumTracks`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (9)</summary>

| Attribute  | Type              | Required | Description               |
| ---------- | ----------------- | -------- | ------------------------- |
| `id`       | `string`          | Yes      | Path parameter.           |
| `page`     | `number`          | Yes      | The page number           |
| `pageSize` | `number`          | Yes      | The page size             |
| `sort`     | `'asc' \| 'desc'` | Yes      | The sort order            |
| `total`    | `number`          | Yes      | The total number of items |
| `search`   | `string`          | No       |                           |
| `sortBy`   | `CatalogSort`     | No       |                           |
| `sortBy`   | `TrackSort`       | No       |                           |
| `state`    | `TrackState`      | No       |                           |

</details>

## Response

`200 OK` — Returns a [TrackPage](../models/catalog/track-page.md) object.
