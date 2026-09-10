---
title: 'ScheduleSlot'
sidebar_position: 1
mdx:
    format: 'md'
---

> One stretch of the station's day: from this time, on these days, the station plays this

<details>
<summary>Attributes (16)</summary>

| Attribute          | Type                                     | Required | Description                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`               | `string`                                 | Yes      | _read-only_                                                                                                                                                                                                                                            |
| `label`            | `string`                                 | Yes      | What the operator calls this stretch of the day. Becomes the broadcast's name                                                                                                                                                                          |
| `startsAtMinutes`  | `number`                                 | Yes      | When it starts, as minutes past midnight on the station's clock                                                                                                                                                                                        |
| `endsAtMinutes`    | `number`                                 | Yes      | When it stops, in the same terms. Before the start means the block runs past midnight, which is ordinary for a late show; equal to it means a full twenty-four hours                                                                                   |
| `days`             | `number[]`                               | No       | The weekdays it runs on, Sunday 0. Absent or empty means every day                                                                                                                                                                                     |
| `sourcePluginId`   | `string`                                 | No       | The plugin the records come from. Absent, with no playlist, is a slot the station fills itself                                                                                                                                                         |
| `sourcePlaylistId` | `string`                                 | No       |                                                                                                                                                                                                                                                        |
| `sourceChartId`    | `string`                                 | No       | A published chart to play instead, as `pluginId:chartId`. An ALTERNATIVE to the playlist pair rather than a companion, and it wins if both are sent: a playlist names copies the station can already fetch and a chart names records it has to look up |
| `sourceChartOrder` | `'countdown' \| 'ranked' \| 'unordered'` | No       | Which way round that chart is played. Absent is `countdown`, which ends on number one. Ignored without `sourceChartId`                                                                                                                                 |
| `personaId`        | `string`                                 | No       | Who hosts this stretch of the day. Absent means the station's own active persona                                                                                                                                                                       |
| `brief`            | `string`                                 | No       | What this stretch of the day is asked to play, in the operator's own words. The same ceiling `PutOnAirInput.brief` has, because a changeover builds one of those from this and the two boxes are one field set on the console                          |
| `eraFrom`          | `number`                                 | No       | The earliest release year this stretch of the day plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period                                                                                  |
| `eraTo`            | `number`                                 | No       | The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone                                                                                                                                                    |
| `callins`          | `boolean`                                | No       | Whether somebody phones in during this stretch of the day. Absent leaves the station's own setting standing, exactly as it does when an operator briefs a broadcast by hand; a `setlist` or a `feature` takes no calls whatever this says              |
| `mode`             | `'rotation' \| 'setlist' \| 'feature'`   | Yes      |                                                                                                                                                                                                                                                        |
| `onEnd`            | `'extend' \| 'repeat' \| 'stop'`         | Yes      |                                                                                                                                                                                                                                                        |

</details>
