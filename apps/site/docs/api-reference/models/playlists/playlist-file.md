---
title: 'PlaylistFile'
sidebar_position: 14
mdx:
    format: 'md'
---

> A playlist as a file: everything somebody would need to rebuild it on another station

<details>
<summary>Attributes (6)</summary>

| Attribute | Type                  | Required | Description                                                                             |
| --------- | --------------------- | -------- | --------------------------------------------------------------------------------------- |
| `format`  | `string`              | Yes      | What shape this is, so a file from a later build says so rather than being read wrongly |
| `takenAt` | `string`              | Yes      | When it was exported, ISO-8601                                                          |
| `station` | `string`              | No       | The station it was taken from. Provenance only                                          |
| `name`    | `string`              | Yes      |                                                                                         |
| `prompt`  | `string`              | No       |                                                                                         |
| `tracks`  | `PlaylistFileTrack[]` | Yes      |                                                                                         |

</details>
