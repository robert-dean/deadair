---
title: 'StationPlaylist'
sidebar_position: 7
mdx:
    format: 'md'
---

> A playlist the station owns: records it holds in its own library, in an order somebody chose, cloned
> from somewhere else and free to differ from it afterwards

<details>
<summary>Attributes (8)</summary>

| Attribute        | Type     | Required | Description                                                                                                              |
| ---------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`             | `string` | Yes      | _read-only_                                                                                                              |
| `name`           | `string` | Yes      |                                                                                                                          |
| `prompt`         | `string` | Yes      | What this playlist is for, in the operator's own words. Empty when nobody said                                           |
| `originPluginId` | `string` | No       | The plugin this was cloned from, for a badge and nothing else. Absent for one read from a file or made here. _read-only_ |
| `trackCount`     | `number` | Yes      | Every row, placeholders included. _read-only_                                                                            |
| `resolvedCount`  | `number` | Yes      | The rows that name a record in the library, which are the ones that can air. _read-only_                                 |
| `createdAt`      | `string` | Yes      | _read-only_                                                                                                              |
| `updatedAt`      | `string` | Yes      | _read-only_                                                                                                              |

</details>
