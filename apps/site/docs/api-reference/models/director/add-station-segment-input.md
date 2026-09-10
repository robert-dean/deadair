---
title: 'AddStationSegmentInput'
sidebar_position: 15
mdx:
    format: 'md'
---

> Put something the station says into the running order

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type     | Required | Description                                                                                                                                              |
| ----------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `segmentId` | `string` | Yes      |                                                                                                                                                          |
| `atIndex`   | `number` | No       | Where to put it. Absent puts it at the end. A position already handed to the player is refused                                                           |
| `overAtMs`  | `number` | No       | Play it OVER the record that follows, this far into it, rather than in the gap before it. Absent plays it between two records, which is the simpler path |

</details>
