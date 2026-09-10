---
title: 'Get album enrichment'
sidebar_label: 'Get album enrichment'
sidebar_position: 8
mdx:
    format: 'md'
---

The record's own enrichment: the label, pressing and cover belong to the release, not to a track on it

**`GET`** `/catalog/albums/{id}/enrichment`

:::note
SDK method: `getAlbumEnrichment`
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

`200 OK` — Returns a [AlbumEnrichmentDetail](../models/catalog/album-enrichment-detail.md) object.
