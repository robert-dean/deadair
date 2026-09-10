---
title: 'CatalogTrack'
sidebar_position: 3
mdx:
    format: 'md'
---

> One record as its PROVIDER describes it, plus what the catalog can say about the same copy.
>
> The first half mirrors the plugin SDK's `ProviderTrack` and stays the provider's answer: this is a
> listing of what a playlist holds, not of what the station has ingested. The three ids below are the
> station's own and are absent for anything it has never seen, which on most playlists is plenty of
> rows — a playlist is a provider's list and the library is what a sync has walked

<details>
<summary>Attributes (10)</summary>

| Attribute    | Type       | Required | Description                                                                                       |
| ------------ | ---------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`         | `string`   | Yes      | The PROVIDER's id for this copy, which is what an import names it by. Never a `deadair.tracks` id |
| `title`      | `string`   | Yes      |                                                                                                   |
| `artists`    | `string[]` | Yes      | Ordered, primary artist first. Empty array if the provider genuinely has none                     |
| `album`      | `string`   | No       |                                                                                                   |
| `durationMs` | `number`   | No       |                                                                                                   |
| `isrc`       | `string`   | No       |                                                                                                   |
| `artworkUrl` | `string`   | No       |                                                                                                   |
| `trackId`    | `string`   | No       | The canonical `deadair.tracks` row this copy is bound to, when the catalog holds one              |
| `artistId`   | `string`   | No       | The canonical artist behind that row                                                              |
| `albumId`    | `string`   | No       | The release that row was ingested inside. Absent for a single ingested outside any                |

</details>
