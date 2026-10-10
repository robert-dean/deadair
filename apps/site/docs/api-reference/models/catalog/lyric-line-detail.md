---
title: 'LyricLineDetail'
sidebar_position: 12
mdx:
    format: 'md'
---

> One timed line of a record's lyrics. Times are milliseconds from the start of the file.

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                 |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------- |
| `atMs`    | `number` | Yes      | Where the line starts. _read-only_                                                          |
| `endMs`   | `number` | No       | Where the line ends, when the source published one. Absent rather than guessed. _read-only_ |
| `text`    | `string` | Yes      | The words of the line. Empty for a gap the source marked between lines. _read-only_         |

</details>
