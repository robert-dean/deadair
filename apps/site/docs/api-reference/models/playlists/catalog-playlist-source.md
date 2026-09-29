---
title: 'CatalogPlaylistSource'
sidebar_position: 5
mdx:
    format: 'md'
---

> One music source whose playlists are in this answer, and how old its list is

<details>
<summary>Attributes (3)</summary>

| Attribute    | Type     | Required | Description                                                                                                                                                                                               |
| ------------ | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`   | `string` | Yes      |                                                                                                                                                                                                           |
| `pluginName` | `string` | Yes      |                                                                                                                                                                                                           |
| `listedAt`   | `string` | Yes      | When the station last read this source's whole list of playlists. The library sync reads it in the background, so this is usually minutes old; a source listed for the first time is read for this answer |

</details>
