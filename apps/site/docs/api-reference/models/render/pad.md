---
title: 'Pad'
sidebar_position: 26
mdx:
    format: 'md'
---

> One sound on a soundboard, as the console draws it.
>
> `name` is what a script writes to hit it and `label` is what a person reads: two columns rather
> than one, because a token for a model and prose for an operator are different things and the
> filename produces both

<details>
<summary>Attributes (11)</summary>

| Attribute      | Type                     | Required | Description                                                                                                                                                               |
| -------------- | ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `string`                 | Yes      | _read-only_                                                                                                                                                               |
| `board`        | `string`                 | Yes      | Which directory it arrived in. Provenance: what reaches it is a set                                                                                                       |
| `sets`         | `string[]`               | Yes      | The keys of the sets it is on. Empty means it is in the library and nothing can hit it. _read-only_                                                                       |
| `name`         | `string`                 | Yes      | What a script writes: `[sfx:airhorn]`                                                                                                                                     |
| `label`        | `string`                 | Yes      |                                                                                                                                                                           |
| `durationMs`   | `number`                 | No       |                                                                                                                                                                           |
| `loudnessLufs` | `number`                 | No       | How loud it came out, once something measured it. Absent on a station with no analyzer, which is ordinary                                                                 |
| `source`       | `string`                 | Yes      | Who put the file there: `library` for one the operator dropped in, `upload` or `url` for one the console wrote. It decides whether the console may delete it. _read-only_ |
| `sourcePath`   | `string`                 | No       | The file in the library directory it was imported from, so the console can say where it came from                                                                         |
| `lastUsedAt`   | `string`                 | No       | When it was last hit. Absent for one nothing has reached for yet                                                                                                          |
| `state`        | `'active' \| 'rejected'` | Yes      |                                                                                                                                                                           |

</details>
