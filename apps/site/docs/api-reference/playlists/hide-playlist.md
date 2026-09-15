---
title: 'Hide playlist'
sidebar_label: 'Hide playlist'
sidebar_position: 3
mdx:
    format: 'md'
---

Hides one playlist from this station: the listing marks it hidden, the pickers stop offering it and the library sync stops reading it. Hiding one already hidden changes nothing

**`PUT`** `/playlists/{pluginId}/{playlistId}/hidden`

:::note
SDK method: `hidePlaylist`
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
