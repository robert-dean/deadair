---
title: 'CatalogPlaylist'
sidebar_position: 2
mdx:
    format: 'md'
---

> A playlist a catalog-capable plugin offers, tagged with the plugin it came from so an aggregated list is addressable

<details>
<summary>Attributes (8)</summary>

| Attribute     | Type                   | Required | Description                                                                                                                                       |
| ------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`    | `string`               | Yes      |                                                                                                                                                   |
| `pluginName`  | `string`               | Yes      |                                                                                                                                                   |
| `id`          | `string`               | Yes      |                                                                                                                                                   |
| `name`        | `string`               | Yes      |                                                                                                                                                   |
| `description` | `string`               | No       |                                                                                                                                                   |
| `trackCount`  | `number`               | No       |                                                                                                                                                   |
| `artworkUrl`  | `string`               | No       |                                                                                                                                                   |
| `permissions` | `PlaylistPermission[]` | No       | What the SOURCE permits on this playlist's items, not what this actor may do. Empty means the source permits nothing; absent means it did not say |

</details>
