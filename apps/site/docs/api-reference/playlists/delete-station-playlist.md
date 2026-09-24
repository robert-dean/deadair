---
title: 'Delete station playlist'
sidebar_label: 'Delete station playlist'
sidebar_position: 10
mdx:
    format: 'md'
---

Deletes a station playlist. The records it named stay in the library

**`DELETE`** `/station-playlists/{id}`

:::note
SDK method: `deleteStationPlaylist`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`204 No Content`

`404 Not Found`
