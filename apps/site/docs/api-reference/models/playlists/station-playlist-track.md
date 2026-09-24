---
title: 'StationPlaylistTrack'
sidebar_position: 9
mdx:
    format: 'md'
---

> One row of a station playlist: a record in the library, or a placeholder for one it does not hold yet

<details>
<summary>Attributes (10)</summary>

| Attribute        | Type       | Required | Description                                                                                                                        |
| ---------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string`   | Yes      | The row's own id, not the record's                                                                                                 |
| `position`       | `number`   | Yes      |                                                                                                                                    |
| `title`          | `string`   | Yes      |                                                                                                                                    |
| `artists`        | `string[]` | Yes      | Ordered, primary artist first                                                                                                      |
| `album`          | `string`   | No       |                                                                                                                                    |
| `durationMs`     | `number`   | No       |                                                                                                                                    |
| `trackId`        | `string`   | No       | The library record this row plays. Absent on a placeholder                                                                         |
| `artistId`       | `string`   | No       |                                                                                                                                    |
| `albumId`        | `string`   | No       |                                                                                                                                    |
| `originPluginId` | `string`   | No       | On a placeholder, the plugin whose copy it was cloned from. Absent on one read from a file, which names a record and no copy of it |

</details>
