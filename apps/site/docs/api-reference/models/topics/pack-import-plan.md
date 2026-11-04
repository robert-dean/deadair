---
title: 'PackImportPlan'
sidebar_position: 9
mdx:
    format: 'md'
---

> What importing a file would do. The preview and the import reach it the same way, so what an operator was shown is what happens

<details>
<summary>Attributes (5)</summary>

| Attribute | Type                  | Required | Description                                                            |
| --------- | --------------------- | -------- | ---------------------------------------------------------------------- |
| `name`    | `string`              | Yes      | What the file says it is. _read-only_                                  |
| `adding`  | `string[]`            | Yes      | What it would add, in the words a list would show. _read-only_         |
| `skipped` | `string[]`            | Yes      | What this station already has, which it would leave alone. _read-only_ |
| `dropped` | `PackImportDropped[]` | Yes      | What it cannot use. _read-only_                                        |
| `notices` | `PackImportNotice[]`  | Yes      | _read-only_                                                            |

</details>
