---
title: 'OccasionImportPlan'
sidebar_position: 12
mdx:
    format: 'md'
---

> What importing a file would do. Everything it adds starts switched off

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                    | Required | Description                                                                                                       |
| --------- | ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`    | `string`                | Yes      | What the file says it is. _read-only_                                                                             |
| `adding`  | `string[]`              | Yes      | The occasions it would add, by their words. _read-only_                                                           |
| `skipped` | `string[]`              | Yes      | The ones this station already has, with the same words and the same rule, which it would leave alone. _read-only_ |
| `dropped` | `OccasionPackDropped[]` | Yes      | The ones it cannot use. _read-only_                                                                               |

</details>
