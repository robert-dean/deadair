---
title: 'Fill station playlist'
sidebar_label: 'Fill station playlist'
sidebar_position: 11
mdx:
    format: 'md'
---

Looks up the records this playlist names and the library does not hold, in the background, and adds the ones a provider has. The activity feed says how it went

**`POST`** `/station-playlists/{id}/fill`

:::note
SDK method: `fillStationPlaylist`
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

`202`

`404 Not Found`
