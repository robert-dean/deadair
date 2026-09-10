---
title: 'StationAir'
sidebar_position: 5
mdx:
    format: 'md'
---

> What the station is airing, and whether it is driving at all

<details>
<summary>Attributes (9)</summary>

| Attribute   | Type        | Required | Description                                                                                                                                                                                                                                  |
| ----------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active`    | `boolean`   | Yes      | False means the station was stood down. What it was playing is remembered so the console can still say what it was                                                                                                                           |
| `airMode`   | `AirMode`   | Yes      | What puts the station on air. In `audience` mode a station that is active with a full running order is still silent while nobody is connected, which is the intended state and not a fault                                                   |
| `name`      | `string`    | No       | What is on. Absent before the station has ever been given anything to play                                                                                                                                                                   |
| `source`    | `string`    | No       | Who built what is on: `import` or `director`                                                                                                                                                                                                 |
| `remaining` | `number`    | Yes      | Items left before the running order runs out and `onEnd` decides what happens                                                                                                                                                                |
| `slotId`    | `string`    | No       | Which slot of the schedule this broadcast belongs to. Absent means nothing scheduled it, which is every station with no schedule                                                                                                             |
| `airSource` | `AirSource` | Yes      | Who is driving the station right now                                                                                                                                                                                                         |
| `held`      | `boolean`   | Yes      | Whether the schedule has been told to leave this broadcast alone. A takeover is otherwise replaced when the block it started inside ends                                                                                                     |
| `holdUntil` | `string`    | No       | When that hold lapses, as an ISO-8601 instant. ABSENT WHILE `held` IS TRUE means until it is released by hand, which is a real state rather than a missing value — `Infinity` is not a thing JSON can carry, so the two facts are two fields |

</details>
