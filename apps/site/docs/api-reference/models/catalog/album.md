---
title: 'Album'
sidebar_position: 4
mdx:
    format: 'md'
---

<details>
<summary>Attributes (10)</summary>

| Attribute        | Type     | Required | Description                                                                                                                                                                                          |
| ---------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string` | Yes      | _read-only_                                                                                                                                                                                          |
| `name`           | `string` | Yes      |                                                                                                                                                                                                      |
| `artistId`       | `string` | Yes      | _read-only_                                                                                                                                                                                          |
| `artistName`     | `string` | Yes      | Joined, so a list renders without a second request per row. _read-only_                                                                                                                              |
| `mbid`           | `string` | No       | MusicBrainz release-group id, absent until enrichment resolves one                                                                                                                                   |
| `year`           | `number` | No       |                                                                                                                                                                                                      |
| `imageUrl`       | `string` | No       | An API-relative path: the cached copy, or the station's proxy for an uncached one                                                                                                                    |
| `rating`         | `Rating` | Yes      | _default: `neutral`_                                                                                                                                                                                 |
| `suspendedUntil` | `string` | No       | Kept off the station until this moment: a scheduling decision with an end date, which leaves `rating` alone. Absent is not suspended, and a suspension that has lapsed is simply absent. _read-only_ |
| `trackCount`     | `number` | Yes      | _read-only_                                                                                                                                                                                          |

</details>
