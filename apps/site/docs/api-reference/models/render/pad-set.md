---
title: 'PadSet'
sidebar_position: 30
mdx:
    format: 'md'
---

> A named collection of pads: what a presenter is actually handed.
>
> One library, cut as many ways as an operator likes. `personas.soundboard` holds the `key`, so
> renaming a set unpoints every persona naming it — which is why `personas` says who those are

<details>
<summary>Attributes (6)</summary>

| Attribute  | Type       | Required | Description                                                                                                       |
| ---------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`       | `string`   | Yes      | _read-only_                                                                                                       |
| `key`      | `string`   | Yes      | The slug a persona names. A directory in the pad library makes one of these                                       |
| `label`    | `string`   | Yes      |                                                                                                                   |
| `position` | `number`   | Yes      |                                                                                                                   |
| `pads`     | `number`   | Yes      | How many sounds are on it. Zero is ordinary: it is what a set looks like before anybody drops a file. _read-only_ |
| `personas` | `string[]` | Yes      | Who is pointed at it, so a rename or a delete can say what it is about to unpoint. _read-only_                    |

</details>
