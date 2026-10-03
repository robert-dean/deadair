---
title: 'PersonaAuditionSource'
sidebar_position: 30
mdx:
    format: 'md'
---

> Where the records came from: exactly one of the provider's pair, `stationPlaylistId` or `chartId`.
> A snapshot of the name rather than a reference, so a source renamed or deleted afterwards leaves a
> finished audition readable

<details>
<summary>Attributes (5)</summary>

| Attribute           | Type     | Required | Description                                                            |
| ------------------- | -------- | -------- | ---------------------------------------------------------------------- |
| `pluginId`          | `string` | No       | The plugin whose playlist it was. Present exactly when `playlistId` is |
| `playlistId`        | `string` | No       |                                                                        |
| `stationPlaylistId` | `string` | No       | A playlist the station owns                                            |
| `chartId`           | `string` | No       | A published chart, as `pluginId:chartId`                               |
| `name`              | `string` | No       |                                                                        |

</details>
