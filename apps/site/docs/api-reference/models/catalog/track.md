---
title: 'Track'
sidebar_position: 5
mdx:
    format: 'md'
---

<details>
<summary>Attributes (12)</summary>

| Attribute       | Type     | Required | Description                                                                                                   |
| --------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `id`            | `string` | Yes      | _read-only_                                                                                                   |
| `title`         | `string` | Yes      |                                                                                                               |
| `artistId`      | `string` | Yes      | _read-only_                                                                                                   |
| `artistName`    | `string` | Yes      | _read-only_                                                                                                   |
| `albumId`       | `string` | No       | Absent on a single ingested outside any release: `tracks.album_id` is nullable. _read-only_                   |
| `albumName`     | `string` | No       | _read-only_                                                                                                   |
| `albumImageUrl` | `string` | No       | The record's cover, in the two spellings `Album.imageUrl` has. Nothing hangs art off a recording. _read-only_ |
| `artists`       | `string` | Yes      | Display credit as written on the release ("X feat. Y"), not a join key                                        |
| `genre`         | `string` | No       |                                                                                                               |
| `year`          | `number` | No       |                                                                                                               |
| `durationMs`    | `number` | No       |                                                                                                               |
| `rating`        | `Rating` | Yes      | _default: `neutral`_                                                                                          |

</details>
