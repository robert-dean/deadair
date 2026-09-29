---
title: 'CatalogPlaylistPage'
sidebar_position: 6
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type                      | Required | Description                                                                                                                                                                                                      |
| ----------- | ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playlists` | `CatalogPlaylist[]`       | Yes      |                                                                                                                                                                                                                  |
| `sources`   | `CatalogPlaylistSource[]` | No       | Every source whose playlists are listed, including one that also has an entry in `errors`: its list is then the last one the station read. Absent from a station that predates it, which asked every source live |
| `errors`    | `CatalogSourceError[]`    | Yes      |                                                                                                                                                                                                                  |

</details>
