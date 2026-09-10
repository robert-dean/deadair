---
title: 'Clear track enrichment'
sidebar_label: 'Clear track enrichment'
sidebar_position: 17
mdx:
    format: 'md'
---

Forget what the providers said, so the enrichment pass asks again

**`DELETE`** `/catalog/tracks/{id}/enrichment`

:::note
SDK method: `clearTrackEnrichment`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type     | Required | Description     |
| ---------- | -------- | -------- | --------------- |
| `id`       | `string` | Yes      | Path parameter. |
| `provider` | `string` | No       |                 |

</details>

## Response

`200 OK` — Returns a [TrackClearResult](../models/catalog/track-clear-result.md) object.
