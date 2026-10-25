---
title: 'BreakKindImportEntry'
sidebar_position: 6
mdx:
    format: 'md'
---

> One kind in a file, and what would become of it here

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                                         | Required | Description                                                                                                                                                                      |
| --------- | -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`     | `string`                                     | Yes      | _read-only_                                                                                                                                                                      |
| `name`    | `string`                                     | Yes      | _read-only_                                                                                                                                                                      |
| `outcome` | `'create' \| 'update' \| 'skip' \| 'refuse'` | Yes      | New here; already here and named in `replace`, so rewritten; already here and left alone; or a key this station uses for a break of its own, which no file can take. _read-only_ |
| `notices` | `BreakKindImportNotice[]`                    | Yes      | _read-only_                                                                                                                                                                      |

</details>
