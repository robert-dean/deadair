---
title: 'AlbumEnrichmentData'
sidebar_position: 26
mdx:
    format: 'md'
---

<details>
<summary>Attributes (11)</summary>

| Attribute     | Type                      | Required | Description                                              |
| ------------- | ------------------------- | -------- | -------------------------------------------------------- |
| `name`        | `string`                  | No       |                                                          |
| `artist`      | `string`                  | No       | The record's own credit, which is not always the track's |
| `year`        | `number`                  | No       |                                                          |
| `releaseDate` | `string`                  | No       | Partial, exactly as on TrackEnrichmentData               |
| `label`       | `string`                  | No       |                                                          |
| `genres`      | `string[]`                | No       |                                                          |
| `facts`       | `string[]`                | No       |                                                          |
| `artworkUrl`  | `string`                  | No       |                                                          |
| `externalIds` | `EnrichmentExternalId[]`  | No       |                                                          |
| `links`       | `EnrichmentLink[]`        | No       |                                                          |
| `extra`       | `Record<string, unknown>` | No       |                                                          |

</details>
