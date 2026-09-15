---
title: 'CatalogPlaylist'
sidebar_position: 2
mdx:
    format: 'md'
---

> A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable

<details>
<summary>Attributes (10)</summary>

| Attribute        | Type                   | Required | Description                                                                                                                                                     |
| ---------------- | ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`       | `string`               | Yes      |                                                                                                                                                                 |
| `pluginName`     | `string`               | Yes      |                                                                                                                                                                 |
| `id`             | `string`               | Yes      |                                                                                                                                                                 |
| `name`           | `string`               | Yes      |                                                                                                                                                                 |
| `description`    | `string`               | No       |                                                                                                                                                                 |
| `trackCount`     | `number`               | No       |                                                                                                                                                                 |
| `artworkUrl`     | `string`               | No       |                                                                                                                                                                 |
| `permissions`    | `PlaylistPermission[]` | No       | What the SOURCE permits on this playlist's items, not what this actor may do. Empty means the source permits nothing; absent means it did not say               |
| `madeByProvider` | `boolean`              | No       | The source made this playlist itself rather than a person: an editorial list, or one generated for the account like Discover Weekly. Absent when it did not say |
| `hidden`         | `boolean`              | No       | An operator hid this playlist from this station, so pickers leave it out and the library sync does not read it. Absent when it is not hidden                    |

</details>
