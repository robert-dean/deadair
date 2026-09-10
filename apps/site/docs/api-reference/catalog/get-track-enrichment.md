---
title: 'Get track enrichment'
sidebar_label: 'Get track enrichment'
sidebar_position: 16
mdx:
    format: 'md'
---

What the providers said about one recording, including everything no canonical column holds

**`GET`** `/catalog/tracks/{id}/enrichment`

:::note
SDK method: `getTrackEnrichment`
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

`200 OK` — Returns a [TrackEnrichmentDetail](../models/catalog/track-enrichment-detail.md) object.
