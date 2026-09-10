---
title: 'Album'
sidebar_position: 4
mdx:
    format: 'md'
---

<details>
<summary>Attributes (9)</summary>

| Attribute    | Type     | Required | Description                                                             |
| ------------ | -------- | -------- | ----------------------------------------------------------------------- |
| `id`         | `string` | Yes      | _read-only_                                                             |
| `name`       | `string` | Yes      |                                                                         |
| `artistId`   | `string` | Yes      | _read-only_                                                             |
| `artistName` | `string` | Yes      | Joined, so a list renders without a second request per row. _read-only_ |
| `mbid`       | `string` | No       | MusicBrainz release-group id, absent until enrichment resolves one      |
| `year`       | `number` | No       |                                                                         |
| `imageUrl`   | `string` | No       | Absolute upstream URL, or an API-relative path to the local copy        |
| `rating`     | `Rating` | Yes      | _default: `neutral`_                                                    |
| `trackCount` | `number` | Yes      | _read-only_                                                             |

</details>
