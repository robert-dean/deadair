---
title: 'NowPlayingTrack'
sidebar_position: 1
mdx:
    format: 'md'
---

> The track a listener is hearing right now

<details>
<summary>Attributes (7)</summary>

| Attribute     | Type     | Required | Description                                                                                                                              |
| ------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | `string` | Yes      |                                                                                                                                          |
| `artist`      | `string` | Yes      | Comma-joined, as a display line rather than a list: this is what a player or a device shows, not something to iterate                    |
| `album`       | `string` | No       |                                                                                                                                          |
| `artworkUrl`  | `string` | No       | The station's own cached cover where there is one, the provider's URL otherwise. Relative values are paths under the API root            |
| `durationMs`  | `number` | No       |                                                                                                                                          |
| `startedAt`   | `number` | Yes      | Unix epoch millis, as observed when the player reported the track started                                                                |
| `remainingMs` | `number` | No       | Absent when the decoder cannot say. It leads the listener by the encoder and client buffers, so it is a display value and not a schedule |

</details>
