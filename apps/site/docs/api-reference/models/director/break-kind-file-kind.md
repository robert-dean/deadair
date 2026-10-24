---
title: 'BreakKindFileKind'
sidebar_position: 4
mdx:
    format: 'md'
---

> One kind of break in a file: everything that says what it is, and nothing about how this station has it set

<details>
<summary>Attributes (8)</summary>

| Attribute       | Type       | Required | Description                                                                             |
| --------------- | ---------- | -------- | --------------------------------------------------------------------------------------- |
| `key`           | `string`   | Yes      | What identifies the kind across two stations, and what a band on the format clock names |
| `name`          | `string`   | Yes      |                                                                                         |
| `brief`         | `string`   | Yes      |                                                                                         |
| `rules`         | `string[]` | Yes      |                                                                                         |
| `showsPrevious` | `boolean`  | Yes      |                                                                                         |
| `showsPlayed`   | `boolean`  | Yes      |                                                                                         |
| `showsFacts`    | `boolean`  | Yes      |                                                                                         |
| `showsNotebook` | `boolean`  | Yes      |                                                                                         |

</details>
