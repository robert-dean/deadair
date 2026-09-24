---
title: 'Get station playlist'
sidebar_label: 'Get station playlist'
sidebar_position: 8
mdx:
    format: 'md'
---

One station playlist with its records in order, placeholders included

**`GET`** `/station-playlists/{id}`

:::note
SDK method: `getStationPlaylist`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [StationPlaylistDetail](../models/playlists/station-playlist-detail.md) object.

`404 Not Found`
