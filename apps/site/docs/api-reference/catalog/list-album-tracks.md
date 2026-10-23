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
<summary>Attributes (11)</summary>

| Attribute        | Type              | Required | Description                                                                                                               |
| ---------------- | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string`          | Yes      | Path parameter.                                                                                                           |
| `total`          | `number`          | Yes      | The total number of items                                                                                                 |
| `analyzer`       | `string`          | No       | Only records this analysis plugin measured, or tried to and failed. The selector for measuring a detector's records again |
| `measureFailure` | `MeasureFailure`  | No       | Only records whose measurement failed this way                                                                            |
| `page`           | `number`          | No       | The page number                                                                                                           |
| `pageSize`       | `number`          | No       | The page size                                                                                                             |
| `search`         | `string`          | No       |                                                                                                                           |
| `sort`           | `'asc' \| 'desc'` | No       | The sort order                                                                                                            |
| `sortBy`         | `CatalogSort`     | No       |                                                                                                                           |
| `sortBy`         | `TrackSort`       | No       |                                                                                                                           |
| `state`          | `TrackState`      | No       |                                                                                                                           |

</details>

## Response

`200 OK` — Returns a [TrackPage](../models/catalog/track-page.md) object.
