---
title: 'Production'
sidebar_position: 2
mdx:
    format: 'md'
---

> Something the station makes rather than something it says: several beats of speech, written in several passes, that airs as one block

<details>
<summary>Attributes (14)</summary>

| Attribute      | Type                                                                                                                                  | Required | Description                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `string`                                                                                                                              | Yes      | _read-only_                                                                                                                                    |
| `kind`         | `string`                                                                                                                              | Yes      | What sort of production: podcast, bulletin, feature. Free text, so a station that wants a documentary strand needs no migration                |
| `title`        | `string`                                                                                                                              | Yes      |                                                                                                                                                |
| `brief`        | `string`                                                                                                                              | No       | What was asked for, in the operator's own words. Distinct from the title, which is only a label                                                |
| `personaId`    | `string`                                                                                                                              | No       | Who presents it. Absent falls back to the station's active persona when a pass runs                                                            |
| `writingMode`  | `'quick' \| 'outlined' \| 'polished'`                                                                                                 | Yes      | How many passes to spend on it                                                                                                                 |
| `targetMs`     | `number`                                                                                                                              | Yes      | How long it should run. What the beat count and the per-beat word budgets are computed from                                                    |
| `state`        | `'planned' \| 'outlining' \| 'drafting' \| 'checking' \| 'rendering' \| 'stitching' \| 'ready' \| 'aired' \| 'failed' \| 'cancelled'` | Yes      | `stitching` is the beats being joined into one piece of audio, and it leads to `ready` whether that worked or not. _read-only_                 |
| `error`        | `string`                                                                                                                              | No       | Why making it did not work. _read-only_                                                                                                        |
| `scheduledFor` | `string`                                                                                                                              | No       | When it should air. Absent means as soon as it is made                                                                                         |
| `cancelledAt`  | `string`                                                                                                                              | No       | _read-only_                                                                                                                                    |
| `beats`        | `number`                                                                                                                              | Yes      | How many beats exist so far, which is how far along the drafting is. _read-only_                                                               |
| `cast`         | `ProductionCastMember[]`                                                                                                              | Yes      | Who is on it, decided by the first pass that ran. Empty for one nobody has started, and for a programme the presenter reads alone. _read-only_ |
| `createdAt`    | `string`                                                                                                                              | Yes      | _read-only_                                                                                                                                    |

</details>
