---
title: 'LogSource'
sidebar_position: 2
mdx:
    format: 'md'
---

> One log file this install has, whether or not anything has been written to it

<details>
<summary>Attributes (7)</summary>

| Attribute     | Type      | Required | Description                                                                                                                    |
| ------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `string`  | Yes      | A closed set the API owns: `api`, `liquidsoap`, `shim`. Never a path                                                           |
| `label`       | `string`  | Yes      |                                                                                                                                |
| `description` | `string`  | Yes      | What writes it, in a sentence, because "shim" means nothing to somebody who has not read the tree                              |
| `present`     | `boolean` | Yes      | Whether the file is there at all. A station that never ran the stream has no stream logs, which is a state rather than a fault |
| `levels`      | `boolean` | Yes      | Whether its lines carry a level, so the console knows whether to offer the filter                                              |
| `bytes`       | `number`  | Yes      | Retained size across every segment. Zero when absent                                                                           |
| `lastWriteAt` | `string`  | No       | Absent when nothing has ever been written                                                                                      |

</details>
