---
title: 'NowPlayingLyrics'
sidebar_position: 5
mdx:
    format: 'md'
---

> The words of whatever record is on air, and where it is in them

<details>
<summary>Attributes (6)</summary>

| Attribute   | Type          | Required | Description                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onAir`     | `boolean`     | Yes      | False when nothing is airing, with everything else absent                                                                                                                                                                                                                                                                                |
| `trackId`   | `string`      | No       | The catalog record on air. Absent while the station is talking, and for a record the catalog has never held                                                                                                                                                                                                                              |
| `startedAt` | `number`      | No       | Unix epoch millis when the record went on air, the same instant `/nowplaying` reports. Match on it before pairing these lyrics with a `/nowplaying` reading                                                                                                                                                                              |
| `cueInMs`   | `number`      | No       | Where in the file the record started playing. Absent means the top of the file                                                                                                                                                                                                                                                           |
| `cueOutMs`  | `number`      | No       | Where in the file the record stops playing. A line's `atMs` counts from the top of the file and the decoder's `remainingMs` counts down to this point, so the position to highlight is this (or the record's `durationMs` when absent) minus `remainingMs`. Absent for a record nothing has measured, which plays to the end of the file |
| `lyrics`    | `TrackLyrics` | No       | The station's answer for that record. Absent with no `trackId`                                                                                                                                                                                                                                                                           |

</details>
