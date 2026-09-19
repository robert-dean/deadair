---
title: 'Refresh playlist'
sidebar_label: 'Refresh playlist'
sidebar_position: 6
mdx:
    format: 'md'
---

Reads one playlist again, in the background. New records reach the library; a record taken out of it stays until the next full read judges it

**`POST`** `/playlists/{pluginId}/{playlistId}/refresh`

:::note
SDK method: `refreshPlaylist`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type     | Required | Description     |
| ------------ | -------- | -------- | --------------- |
| `playlistId` | `string` | Yes      | Path parameter. |
| `pluginId`   | `string` | Yes      | Path parameter. |

</details>
