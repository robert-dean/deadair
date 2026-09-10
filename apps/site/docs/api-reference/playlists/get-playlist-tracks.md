---
title: 'Get playlist tracks'
sidebar_label: 'Get playlist tracks'
sidebar_position: 2
mdx:
    format: 'md'
---

One playlist's tracks from one plugin

**`GET`** `/playlists/{pluginId}/{playlistId}/tracks`

:::note
SDK method: `getPlaylistTracks`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type     | Required | Description     |
| ------------ | -------- | -------- | --------------- |
| `playlistId` | `string` | Yes      | Path parameter. |
| `pluginId`   | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [CatalogPlaylistTracks](../models/playlists/catalog-playlist-tracks.md) object.
