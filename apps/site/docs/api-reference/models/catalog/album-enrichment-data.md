---
title: 'AlbumEnrichmentData'
sidebar_position: 32
mdx:
    format: 'md'
---

<details>
<summary>Attributes (11)</summary>

| Attribute     | Type                      | Required | Description                                                                                                                                               |
| ------------- | ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                  | No       |                                                                                                                                                           |
| `artist`      | `string`                  | No       | The record's own credit, which is not always the track's                                                                                                  |
| `year`        | `number`                  | No       |                                                                                                                                                           |
| `releaseDate` | `string`                  | No       | Partial, exactly as on TrackEnrichmentData                                                                                                                |
| `label`       | `string`                  | No       |                                                                                                                                                           |
| `genres`      | `string[]`                | No       |                                                                                                                                                           |
| `facts`       | `string[]`                | No       |                                                                                                                                                           |
| `artworkUrl`  | `string`                  | No       | The provider's picture as the station serves it: `art/<id>` once cached, else the station's proxy `art/source/<token>`. Never the URL the plugin supplied |
| `externalIds` | `EnrichmentExternalId[]`  | No       |                                                                                                                                                           |
| `links`       | `EnrichmentLink[]`        | No       |                                                                                                                                                           |
| `extra`       | `Record<string, unknown>` | No       |                                                                                                                                                           |

</details>
