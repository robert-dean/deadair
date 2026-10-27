---
title: 'Recording'
sidebar_position: 2
mdx:
    format: 'md'
---

> One file in the station's archive of what it aired.

<details>
<summary>Attributes (8)</summary>

| Attribute   | Type            | Required | Description                                                                                                                |
| ----------- | --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string`        | Yes      | Names the recording, e.g. `2026-10-27T21-03-12-live`. _read-only_                                                          |
| `kind`      | `RecordingKind` | Yes      | _read-only_                                                                                                                |
| `title`     | `string`        | No       | The show's name, for a live show armed with one. _read-only_                                                               |
| `startedAt` | `string`        | Yes      | _read-only_                                                                                                                |
| `endedAt`   | `string`        | No       | Absent while it is still being recorded. _read-only_                                                                       |
| `bytes`     | `number`        | Yes      | _read-only_                                                                                                                |
| `recording` | `boolean`       | Yes      | Still being written. It cannot be deleted until it ends. _read-only_                                                       |
| `audioUrl`  | `string`        | Yes      | Where a player can stream it from, signed for a while so an audio element needs no token. Relative to the API. _read-only_ |

</details>
