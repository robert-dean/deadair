---
title: 'ScheduleNow'
sidebar_position: 6
mdx:
    format: 'md'
---

> Which slot the clock says should be on right now, and what follows it

<details>
<summary>Attributes (4)</summary>

| Attribute      | Type                   | Required | Description                                                                                                                                                                                                                                                                                           |
| -------------- | ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `now`          | `string`               | Yes      | What time it is on the station's own clock, in the same zone-naive `YYYY-MM-DD HH:mm:ss` shape as a block's ends. It is here so a caller can say how much of the block is left without knowing the station's timezone: subtracting two readings taken in one frame is arithmetic, deriving one is not |
| `slotId`       | `string`               | No       | The slot in force at this instant. Absent means the station has no schedule                                                                                                                                                                                                                           |
| `airingSlotId` | `string`               | No       | The slot the running order actually belongs to. Different from the one above while an operator's own choice holds, which it does until the next slot begins                                                                                                                                           |
| `upcoming`     | `ScheduleOccurrence[]` | Yes      | The block on now, if there is one, and the few that follow it, earliest first. Empty for a station with nothing scheduled from here on. A gap is simply absent, exactly as it is on the timetable: what plays there is the sustaining source rather than a block                                      |

</details>
