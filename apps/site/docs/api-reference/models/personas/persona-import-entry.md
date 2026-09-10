---
title: 'PersonaImportEntry'
sidebar_position: 21
mdx:
    format: 'md'
---

> One character in a file, and what would become of it here

<details>
<summary>Attributes (9)</summary>

| Attribute     | Type                    | Required | Description                                                                                                                                                             |
| ------------- | ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`         | `string`                | Yes      | What identifies this character across two installs. _read-only_                                                                                                         |
| `label`       | `string`                | Yes      | _read-only_                                                                                                                                                             |
| `kind`        | `'host' \| 'caller'`    | No       | _read-only_                                                                                                                                                             |
| `outcome`     | `'create' \| 'update'`  | Yes      | Whether this station holds a character under this key already. An update rewrites the sheet and adds stories; it never deletes one the operator here wrote. _read-only_ |
| `storiesNew`  | `number`                | Yes      | _read-only_                                                                                                                                                             |
| `storiesHeld` | `number`                | Yes      | Already here under the same handle, so importing would skip them. _read-only_                                                                                           |
| `detailsNew`  | `number`                | Yes      | _read-only_                                                                                                                                                             |
| `detailsHeld` | `number`                | Yes      | _read-only_                                                                                                                                                             |
| `notices`     | `PersonaImportNotice[]` | Yes      | _read-only_                                                                                                                                                             |

</details>
