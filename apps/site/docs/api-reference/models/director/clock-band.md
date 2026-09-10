---
title: 'ClockBand'
sidebar_position: 1
mdx:
    format: 'md'
---

> One rule on the station's format clock: a sort of break, and when it happens

<details>
<summary>Attributes (10)</summary>

| Attribute    | Type                    | Required | Description                                                                                                                                                   |
| ------------ | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`                | Yes      | _read-only_                                                                                                                                                   |
| `kind`       | `string`                | Yes      | Which sort of break this slot wants, as `segments.kind` spells it. Free text: a station that wants sponsor spots writes `sponsor` and drops the recordings in |
| `at`         | `'clock' \| 'interval'` | Yes      | `clock` is a time of day and `interval` is a spacing rule for a kind the station's own interval does not cover                                                |
| `hour`       | `number`                | No       | For a `clock` band: the hour it happens at. Absent means every hour, which is the common case                                                                 |
| `minute`     | `number`                | No       | For a `clock` band: minutes past the hour                                                                                                                     |
| `everyMs`    | `number`                | No       | For an `interval` band: how far apart, in milliseconds                                                                                                        |
| `position`   | `number`                | Yes      | Where this sits in the operator's own order, which is what settles a boundary two rules both want                                                             |
| `enabled`    | `boolean`               | Yes      | A rule turned off without being lost                                                                                                                          |
| `topicId`    | `string`                | No       | What this band is about, as a subject of its own kind: a news category, later a weather location. Absent means it covers whatever it finds                    |
| `topicLabel` | `string`                | No       | That subject's name, so a list can be drawn without a second call. _read-only_                                                                                |

</details>
