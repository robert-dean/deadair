---
title: 'Get artist enrichment'
sidebar_label: 'Get artist enrichment'
sidebar_position: 3
mdx:
    format: 'md'
---

What every enrichment provider said about this artist, and when each of them said it

**`GET`** `/catalog/artists/{id}/enrichment`

:::note
SDK method: `getArtistEnrichment`
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

`200 OK` — Returns a [ArtistEnrichmentDetail](../models/catalog/artist-enrichment-detail.md) object.
