---
title: 'PersonaImportPlan'
sidebar_position: 20
mdx:
    format: 'md'
---

> What importing a file WOULD do, worked out against this station and written nowhere.
>
> The same code the import itself runs, so what this reports is what will happen rather than a second
> opinion about it. It answers two questions an operator cannot get from the file alone: which
> characters are new here and which would be rewritten, and what this station cannot honour about them

<details>
<summary>Attributes (5)</summary>

| Attribute  | Type                    | Required | Description                                                                                                                                                                                           |
| ---------- | ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`   | `string`                | Yes      | What the file said it was. Reported rather than enforced: this repo edits migrations in place, so a version stamp cannot promise a shape, and the shapes are what was actually validated. _read-only_ |
| `station`  | `string`                | No       | The station it was taken from, when it said. _read-only_                                                                                                                                              |
| `takenAt`  | `string`                | No       | When it was taken, when it said. _read-only_                                                                                                                                                          |
| `notices`  | `PersonaImportNotice[]` | Yes      | About the FILE rather than any one character in it. _read-only_                                                                                                                                       |
| `personas` | `PersonaImportEntry[]`  | Yes      | _read-only_                                                                                                                                                                                           |

</details>
