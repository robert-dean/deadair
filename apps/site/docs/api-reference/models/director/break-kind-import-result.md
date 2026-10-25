---
title: 'BreakKindImportResult'
sidebar_position: 8
mdx:
    format: 'md'
---

> What importing did, with the plan it did it from. All or nothing

<details>
<summary>Attributes (5)</summary>

| Attribute | Type                  | Required | Description                                                                                  |
| --------- | --------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `plan`    | `BreakKindImportPlan` | Yes      | _read-only_                                                                                  |
| `created` | `number`              | Yes      | _read-only_                                                                                  |
| `updated` | `number`              | Yes      | Kinds rewritten from the file, and switched off until read back. _read-only_                 |
| `skipped` | `number`              | Yes      | Kinds this station already held and was not asked to replace, or could not take. _read-only_ |
| `kinds`   | `BreakKind[]`         | Yes      | The list as it now stands. _read-only_                                                       |

</details>
