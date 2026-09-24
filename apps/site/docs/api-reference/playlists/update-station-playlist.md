---
title: 'Update station playlist'
sidebar_label: 'Update station playlist'
sidebar_position: 9
mdx:
    format: 'md'
---

Renames a station playlist, or rewrites what it is for

**`PATCH`** `/station-playlists/{id}`

:::note
SDK method: `updateStationPlaylist`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [StationPlaylistUpdate](../models/playlists/station-playlist-update.md) object.

## Response

`200 OK` — Returns a [StationPlaylist](../models/playlists/station-playlist.md) object.

`404 Not Found`
