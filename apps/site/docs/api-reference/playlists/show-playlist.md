---
title: 'Show playlist'
sidebar_label: 'Show playlist'
sidebar_position: 4
mdx:
    format: 'md'
---

Shows a hidden playlist again. Showing one that is not hidden changes nothing

**`DELETE`** `/playlists/{pluginId}/{playlistId}/hidden`

:::note
SDK method: `showPlaylist`
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
