---
title: 'ScheduleOccurrence'
sidebar_position: 7
mdx:
    format: 'md'
---

> One block: this slot, on this day, between these two times

<details>
<summary>Attributes (5)</summary>

| Attribute | Type      | Required | Description                                                                                                                                                                              |
| --------- | --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slotId`  | `string`  | Yes      |                                                                                                                                                                                          |
| `label`   | `string`  | Yes      |                                                                                                                                                                                          |
| `start`   | `string`  | Yes      | `YYYY-MM-DD HH:mm:ss` on the station's own clock, deliberately carrying no timezone offset: it is a reading rather than a moment, so it draws as written wherever the console is running |
| `end`     | `string`  | Yes      | The same, exclusive. Every block stays inside one day, so a slot running past midnight arrives as two                                                                                    |
| `live`    | `boolean` | No       | Whether the block is a booked live show, when a presenter is meant to take the air through the live input. Absent is no                                                                  |

</details>
