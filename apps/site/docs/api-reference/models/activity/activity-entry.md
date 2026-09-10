---
title: 'ActivityEntry'
sidebar_position: 3
mdx:
    format: 'md'
---

> One thing that happened, from whichever of the feed's sources holds it

<details>
<summary>Attributes (9)</summary>

| Attribute   | Type                      | Required | Description                                                                                                                                           |
| ----------- | ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string`                  | Yes      | Unique across the whole feed, and half of the cursor below                                                                                            |
| `at`        | `string`                  | Yes      | When it happened, as the database recorded it                                                                                                         |
| `module`    | `ActivityModule`          | Yes      |                                                                                                                                                       |
| `kind`      | `string`                  | Yes      | Dotted and stable: `silence.cause`, `air.on`, `segment.ready`, `track.aired`. What a console draws a line with, never something a decision is made on |
| `severity`  | `ActivitySeverity`        | Yes      |                                                                                                                                                       |
| `detail`    | `string`                  | Yes      | The sentence a person reads, phrased by whatever produced it                                                                                          |
| `data`      | `Record<string, unknown>` | No       | The structured half, for a reader that wants to filter or chart rather than read                                                                      |
| `segmentId` | `string`                  | No       | The segment this is about, for an entry that came from one                                                                                            |
| `trackId`   | `string`                  | No       | The catalog track this is about, for an entry that came from one                                                                                      |

</details>
