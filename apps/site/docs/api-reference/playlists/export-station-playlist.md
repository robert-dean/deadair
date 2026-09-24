---
title: 'Export station playlist'
sidebar_label: 'Export station playlist'
sidebar_position: 12
mdx:
    format: 'md'
---

One station playlist as a file another station can import

**`GET`** `/station-playlists/{id}/export`

:::note
SDK method: `exportStationPlaylist`
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

`200 OK` — Returns a [PlaylistFile](../models/playlists/playlist-file.md) object.

Response headers:

| Header                | Type     | Description |
| --------------------- | -------- | ----------- |
| `Content-Disposition` | `string` |             |

`404 Not Found`
