---
title: 'NowPlayingTrack'
sidebar_position: 1
mdx:
    format: 'md'
---

> What a listener is hearing right now: a record, or the station talking

<details>
<summary>Attributes (8)</summary>

| Attribute     | Type                  | Required | Description                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`        | `'record' \| 'break'` | Yes      | `record` is music. `break` is the station speaking on its own between two records (an ident, a bulletin, a talk break), with `artist` empty and `title` the break's own label. A presenter talking over the start of a record is not a break: the record is what is on air, and it stays `record`. Absent means `record`, which is all a station older than this field ever reported. _default: `record`_ |
| `title`       | `string`              | Yes      |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `artist`      | `string`              | Yes      | Comma-joined, as a display line rather than a list: this is what a player or a device shows, not something to iterate. Empty for a `break`                                                                                                                                                                                                                                                                |
| `album`       | `string`              | No       |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `artworkUrl`  | `string`              | No       | The station's own cached cover where there is one, the provider's URL otherwise. Relative values are paths under the API root                                                                                                                                                                                                                                                                             |
| `durationMs`  | `number`              | No       |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `startedAt`   | `number`              | Yes      | Unix epoch millis, as observed when the player reported the track started                                                                                                                                                                                                                                                                                                                                 |
| `remainingMs` | `number`              | No       | Absent when the decoder cannot say. It leads the listener by the encoder and client buffers, so it is a display value and not a schedule                                                                                                                                                                                                                                                                  |

</details>
