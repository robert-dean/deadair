---
title: 'ConfigFieldPreset'
sidebar_position: 9
mdx:
    format: 'md'
---

> A row a `list` field offers to start from instead of an empty one. Adding a row from it fills the cells it names, by column key, and nothing records which preset a row came from

<details>
<summary>Attributes (2)</summary>

| Attribute | Type                     | Required | Description                                                                         |
| --------- | ------------------------ | -------- | ----------------------------------------------------------------------------------- |
| `label`   | `string`                 | Yes      | What the operator picks it by                                                       |
| `cells`   | `Record<string, string>` | Yes      | Cell values by column key. A key with no column, or a `secret` column's, is ignored |

</details>
