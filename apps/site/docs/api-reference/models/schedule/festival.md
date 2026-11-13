---
title: 'Festival'
sidebar_position: 1
mdx:
    format: 'md'
---

> A music festival the station can build a show around: its dates, where it is, and who is on the bill. What a presenter says about it is read from here, so its dates are the ones an operator typed or checked

<details>
<summary>Attributes (9)</summary>

| Attribute        | Type                           | Required | Description                                                                                                                                           |
| ---------------- | ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string`                       | Yes      | _read-only_                                                                                                                                           |
| `name`           | `string`                       | Yes      | Said on air as written: `Shaky Knees`, `the Newport Folk Festival`                                                                                    |
| `startsOn`       | `string`                       | Yes      | The first day, as `YYYY-MM-DD` on the festival's own calendar                                                                                         |
| `endsOn`         | `string`                       | Yes      | The last day, inclusive. The same as `startsOn` for a one-day festival                                                                                |
| `place`          | `string`                       | No       | Where it is, as a presenter would say it: `Piedmont Park, Atlanta`. Absent says nothing about where                                                   |
| `url`            | `string`                       | No       | The festival's own page. Kept as where the facts came from, and never read out                                                                        |
| `acts`           | `FestivalAct[]`                | Yes      | Who is on the bill, in the order they should be listed. A name given twice is kept once                                                               |
| `state`          | `'upcoming' \| 'on' \| 'over'` | Yes      | Where the festival stands on the station's calendar today: still to come, on now, or finished. A finished festival is never talked about. _read-only_ |
| `sourcePluginId` | `string`                       | No       | The plugin a festival was imported from. Absent for one an operator typed. _read-only_                                                                |

</details>
