---
title: 'List tracks'
sidebar_label: 'List tracks'
sidebar_position: 18
mdx:
    format: 'md'
---

Every track, flat. The only way to answer "do we have this song?" without knowing its artist

**`GET`** `/catalog/tracks`

:::note
SDK method: `listTracks`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (8)</summary>

| Attribute  | Type              | Required | Description               |
| ---------- | ----------------- | -------- | ------------------------- |
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
