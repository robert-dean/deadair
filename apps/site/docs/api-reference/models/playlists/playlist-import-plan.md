---
title: 'PlaylistImportPlan'
sidebar_position: 18
mdx:
    format: 'md'
---

> What an import WOULD do, written nowhere

<details>
<summary>Attributes (7)</summary>

| Attribute  | Type                    | Required | Description                                                                      |
| ---------- | ----------------------- | -------- | -------------------------------------------------------------------------------- |
| `name`     | `string`                | Yes      |                                                                                  |
| `matched`  | `number`                | Yes      |                                                                                  |
| `toAdd`    | `number`                | Yes      |                                                                                  |
| `toLookUp` | `number`                | Yes      |                                                                                  |
| `skipped`  | `number`                | Yes      | Lines of the source that named no record the station could read                  |
| `entries`  | `PlaylistImportEntry[]` | Yes      |                                                                                  |
| `notices`  | `string[]`              | Yes      | Anything about the source as a whole an operator should know before importing it |

</details>
