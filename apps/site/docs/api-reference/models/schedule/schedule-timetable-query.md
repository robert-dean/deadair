---
title: 'ScheduleTimetableQuery'
sidebar_position: 3
mdx:
    format: 'md'
---

> A window of the station's day to draw

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                 |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`    | `string` | No       | The first day to draw, as `YYYY-MM-DD` on the station's own calendar. Absent means the station's today, which is the only way a caller that does not know the station's timezone can anchor |
| `days`    | `number` | No       | How many days from `from`. Defaults to a week                                                                                                                                               |

</details>
