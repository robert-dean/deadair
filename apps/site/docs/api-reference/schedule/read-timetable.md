---
title: 'Read timetable'
sidebar_label: 'Read timetable'
sidebar_position: 4
mdx:
    format: 'md'
---

The station's day as blocks, contiguous and gapless, for drawing

**`GET`** `/schedule/timetable`

:::note
SDK method: `readTimetable`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                 |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `days`    | `number` | No       | How many days from `from`. Defaults to a week                                                                                                                                               |
| `from`    | `string` | No       | The first day to draw, as `YYYY-MM-DD` on the station's own calendar. Absent means the station's today, which is the only way a caller that does not know the station's timezone can anchor |

</details>

## Response

`200 OK` — Returns a [ScheduleTimetable](../models/schedule/schedule-timetable.md) object.
