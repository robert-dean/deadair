---
title: 'PackImportDropped'
sidebar_position: 7
mdx:
    format: 'md'
---

> An entry in a file that importing it would leave out, and why

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                            |
| --------- | -------- | -------- | ------------------------------------------------------ |
| `entry`   | `number` | Yes      | Which entry in the file, counting from 1. _read-only_  |
| `words`   | `string` | No       | What the entry calls itself, when it does. _read-only_ |
| `reason`  | `string` | Yes      | Why the station cannot use it. _read-only_             |

</details>
