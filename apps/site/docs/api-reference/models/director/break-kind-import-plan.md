---
title: 'BreakKindImportPlan'
sidebar_position: 5
mdx:
    format: 'md'
---

> What importing a file WOULD do here, worked out by the same code the import runs and written nowhere

<details>
<summary>Attributes (5)</summary>

| Attribute | Type                      | Required | Description                                                |
| --------- | ------------------------- | -------- | ---------------------------------------------------------- |
| `format`  | `string`                  | Yes      | What the file said it was. _read-only_                     |
| `station` | `string`                  | No       | The station it was taken from, when it said. _read-only_   |
| `takenAt` | `string`                  | No       | When it was taken, when it said. _read-only_               |
| `notices` | `BreakKindImportNotice[]` | Yes      | About the file rather than any one kind in it. _read-only_ |
| `kinds`   | `BreakKindImportEntry[]`  | Yes      | _read-only_                                                |

</details>
