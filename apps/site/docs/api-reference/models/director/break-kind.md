---
title: 'BreakKind'
sidebar_position: 1
mdx:
    format: 'md'
---

> A kind of break you write yourself: a brief in prose, and what the presenter is shown while writing one

<details>
<summary>Attributes (11)</summary>

| Attribute       | Type       | Required | Description                                                                                                                                                                        |
| --------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `string`   | Yes      | _read-only_                                                                                                                                                                        |
| `key`           | `string`   | Yes      | The kind, as a band on the format clock names it: lowercase words joined by hyphens. Fixed once the kind is created, because every band and every break it ever planted carries it |
| `name`          | `string`   | Yes      | What the console calls it. Never read out                                                                                                                                          |
| `brief`         | `string`   | Yes      | What this kind of break is for and when to say nothing, written as an instruction to the presenter. The station's own rules for every break still apply on top of it               |
| `rules`         | `string[]` | Yes      | Anything this kind owes beyond the rules every break owes, one per entry. Added to those rules, never in place of them                                                             |
| `showsPrevious` | `boolean`  | Yes      | Whether the presenter is shown the record that has just finished                                                                                                                   |
| `showsPlayed`   | `boolean`  | Yes      | Whether the presenter is shown the rest of this broadcast's records, to refer back to                                                                                              |
| `showsFacts`    | `boolean`  | Yes      | Whether the records shown carry the notes the station holds about them                                                                                                             |
| `showsNotebook` | `boolean`  | Yes      | Whether the presenter is shown their own notebook                                                                                                                                  |
| `enabled`       | `boolean`  | Yes      | Whether the station writes this kind at all. A new or imported kind is off until you switch it on                                                                                  |
| `position`      | `number`   | Yes      | Your own order, for the list                                                                                                                                                       |

</details>
