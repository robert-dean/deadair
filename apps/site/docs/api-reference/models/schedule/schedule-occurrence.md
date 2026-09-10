---
title: 'ScheduleOccurrence'
sidebar_position: 5
mdx:
    format: 'md'
---

> One block: this slot, on this day, between these two times

<details>
<summary>Attributes (4)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                              |
| --------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slotId`  | `string` | Yes      |                                                                                                                                                                                          |
| `label`   | `string` | Yes      |                                                                                                                                                                                          |
| `start`   | `string` | Yes      | `YYYY-MM-DD HH:mm:ss` on the station's own clock, deliberately carrying no timezone offset: it is a reading rather than a moment, so it draws as written wherever the console is running |
| `end`     | `string` | Yes      | The same, exclusive. Every block stays inside one day, so a slot running past midnight arrives as two                                                                                    |

</details>
