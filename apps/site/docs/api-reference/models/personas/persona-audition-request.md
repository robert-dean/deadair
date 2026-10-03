---
title: 'PersonaAuditionRequest'
sidebar_position: 29
mdx:
    format: 'md'
---

> What an operator asks for when they put a character through a playlist or a chart. Exactly one
> source: a provider's playlist, a playlist the station owns, or a published chart. It is READ at the
> moment of asking and its records are stored on the run, so a list edited afterwards does not change
> what was measured

<details>
<summary>Attributes (6)</summary>

| Attribute           | Type     | Required | Description                                                                                                                                                                                                         |
| ------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`          | `string` | No       | Which catalog plugin the playlist belongs to. Required alongside `playlistId`                                                                                                                                       |
| `playlistId`        | `string` | No       |                                                                                                                                                                                                                     |
| `stationPlaylistId` | `string` | No       | A playlist the station owns to audition over instead. An ALTERNATIVE to `pluginId` and `playlistId`, and to `chartId`. A row the library does not hold yet is still a record the host can talk about, so it is kept |
| `chartId`           | `string` | No       | A published chart to audition over instead, as `pluginId:chartId`, from its top. An ALTERNATIVE to the other sources. Its entries are never looked up at a provider, since nothing in an audition airs              |
| `name`              | `string` | No       | What the source is called, kept as a caption for the run. The console already holds it, and a run whose source is later renamed or deleted stays readable                                                           |
| `limit`             | `number` | Yes      | How many breaks to write. One more record than this is taken off the source, since a break sits between two. _default: `10`_                                                                                        |

</details>
