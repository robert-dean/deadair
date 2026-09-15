---
title: 'StationEpisode'
sidebar_position: 3
mdx:
    format: 'md'
---

> One episode of a programme the station carries, and what the station has done with it

<details>
<summary>Attributes (17)</summary>

| Attribute          | Type      | Required | Description                                                               |
| ------------------ | --------- | -------- | ------------------------------------------------------------------------- |
| `id`               | `string`  | Yes      | The station's own id for this episode                                     |
| `showId`           | `string`  | Yes      | Qualified, matching `StationShow.id`                                      |
| `episodeId`        | `string`  | Yes      | The plugin's own id for the episode, stable across refreshes              |
| `showTitle`        | `string`  | Yes      |                                                                           |
| `title`            | `string`  | Yes      |                                                                           |
| `summary`          | `string`  | No       | What the publisher says it is about, as plain text                        |
| `url`              | `string`  | No       | The episode's page, for a person                                          |
| `publishedAt`      | `string`  | No       | ISO-8601                                                                  |
| `durationMs`       | `number`  | No       | How long the publisher says it runs, in milliseconds                      |
| `artworkUrl`       | `string`  | No       |                                                                           |
| `explicit`         | `boolean` | No       |                                                                           |
| `seenAt`           | `string`  | Yes      | ISO-8601: when a refresh last saw it in its feed                          |
| `fetched`          | `boolean` | Yes      | Whether the station holds its own copy of the audio, ready to air         |
| `fetchRequestedAt` | `string`  | No       | ISO-8601: when the station last asked for the audio                       |
| `fetchError`       | `string`  | No       | Why the last attempt to fetch the audio failed, when it did               |
| `scheduledFor`     | `string`  | No       | ISO-8601: the slot the audio was fetched for                              |
| `airedAt`          | `string`  | No       | ISO-8601: when a listener could first have heard it. An episode airs once |

</details>
