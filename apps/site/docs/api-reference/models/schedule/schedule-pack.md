---
title: 'SchedulePack'
sidebar_position: 26
mdx:
    format: 'md'
---

> A schedule as one file, to hand to another station. Each entry is a slot as this API writes it, with
> `personaKey` for `personaId`, `stationPlaylistName` for `sourceStationPlaylistId`, and `personaKey` on each
> co-host and guest host, since an id means nothing elsewhere. Each is read when it is imported, so one a
> station cannot use is reported rather than refusing the file

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                        | Required | Description                                                       |
| --------- | --------------------------- | -------- | ----------------------------------------------------------------- |
| `format`  | `'deadair.schedule'`        | Yes      | Says the file is a schedule file                                  |
| `version` | `number`                    | Yes      | The version of the document's shape. This station reads version 1 |
| `name`    | `string`                    | Yes      | What the file is, as whoever made it would describe it            |
| `slots`   | `Record<string, unknown>[]` | Yes      |                                                                   |

</details>
