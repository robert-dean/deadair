---
title: 'BlockRule'
sidebar_position: 23
mdx:
    format: 'md'
---

> A never-play rule: a KIND of record the station must not play. Absolute, like a dislike, and
> exclude-only: there is no "only these" rule, because one could leave the station nothing to play.
> Every scope is optional and an absent one means "always"

<details>
<summary>Attributes (11)</summary>

| Attribute    | Type                                       | Required | Description                                                                                                                                                                                            |
| ------------ | ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `string`                                   | Yes      | _read-only_                                                                                                                                                                                            |
| `field`      | `'genre' \| 'tag'`                         | Yes      | `genre` refuses any record tagged with this genre or a kind of it (`Punk Rock` under `Punk`, never `Pop` under `Pop Punk`, never `Trap` under `Rap`). `tag` refuses a record carrying exactly this tag |
| `value`      | `string`                                   | Yes      | The genre or tag, as you would write it                                                                                                                                                                |
| `seasonFrom` | `string`                                   | No       | First day it holds, as `MM-DD`. With `seasonTo`; a season starting after it ends wraps the year end                                                                                                    |
| `seasonTo`   | `string`                                   | No       | Last day it holds, as `MM-DD`                                                                                                                                                                          |
| `fromHour`   | `number`                                   | No       | First hour of the station's day it holds. With `untilHour`; a window starting after it ends wraps midnight                                                                                             |
| `untilHour`  | `number`                                   | No       | The hour it stops holding, exclusive                                                                                                                                                                   |
| `modes`      | `('rotation' \| 'setlist' \| 'feature')[]` | No       | Only while the station is in one of these modes. Absent or empty means every mode                                                                                                                      |
| `slotIds`    | `string[]`                                 | No       | Only during these schedule blocks. Absent or empty means whatever is on                                                                                                                                |
| `endsAt`     | `string`                                   | No       | When it stops holding. Absent means until it is removed                                                                                                                                                |
| `inForce`    | `boolean`                                  | Yes      | Whether it holds right now, on the station's clock, for what is on air. _read-only_                                                                                                                    |

</details>
