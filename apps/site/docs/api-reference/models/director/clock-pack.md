---
title: 'ClockPack'
sidebar_position: 11
mdx:
    format: 'md'
---

> A format clock as one file, to hand to another station. Each entry is read as a `ClockPackRow` when it
> is imported, so one a station cannot use is reported rather than refusing the file

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                        | Required | Description                                                       |
| --------- | --------------------------- | -------- | ----------------------------------------------------------------- |
| `format`  | `'deadair.clock'`           | Yes      | Says the file is a clock file                                     |
| `version` | `number`                    | Yes      | The version of the document's shape. This station reads version 1 |
| `name`    | `string`                    | Yes      | What the file is, as whoever made it would describe it            |
| `bands`   | `Record<string, unknown>[]` | Yes      |                                                                   |

</details>
