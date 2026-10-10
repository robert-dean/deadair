---
title: 'ArtistEnrichmentData'
sidebar_position: 27
mdx:
    format: 'md'
---

<details>
<summary>Attributes (8)</summary>

| Attribute     | Type                      | Required | Description                                                                                                                                               |
| ------------- | ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                  | No       |                                                                                                                                                           |
| `biography`   | `string`                  | No       |                                                                                                                                                           |
| `imageUrl`    | `string`                  | No       | The provider's picture as the station serves it: `art/<id>` once cached, else the station's proxy `art/source/<token>`. Never the URL the plugin supplied |
| `genres`      | `string[]`                | No       |                                                                                                                                                           |
| `facts`       | `string[]`                | No       |                                                                                                                                                           |
| `externalIds` | `EnrichmentExternalId[]`  | No       |                                                                                                                                                           |
| `links`       | `EnrichmentLink[]`        | No       |                                                                                                                                                           |
| `extra`       | `Record<string, unknown>` | No       |                                                                                                                                                           |

</details>
