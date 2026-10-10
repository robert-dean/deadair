---
title: 'NowPlayingLyrics'
sidebar_position: 5
mdx:
    format: 'md'
---

> The words of whatever record is on air, and where it is in them

<details>
<summary>Attributes (5)</summary>

| Attribute   | Type          | Required | Description                                                                                                                                                                                               |
| ----------- | ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onAir`     | `boolean`     | Yes      | False when nothing is airing, with everything else absent                                                                                                                                                 |
| `trackId`   | `string`      | No       | The catalog record on air. Absent while the station is talking, and for a record the catalog has never held                                                                                               |
| `startedAt` | `number`      | No       | Unix epoch millis when the record went on air, the same instant `/nowplaying` reports                                                                                                                     |
| `cueInMs`   | `number`      | No       | Where in the file the record started playing. A line's `atMs` counts from the top of the file, so the position to highlight is now minus `startedAt` plus this. Absent means the record airs from the top |
| `lyrics`    | `TrackLyrics` | No       | The station's answer for that record. Absent with no `trackId`                                                                                                                                            |

</details>
