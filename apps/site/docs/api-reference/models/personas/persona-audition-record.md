---
title: 'PersonaAuditionRecord'
sidebar_position: 28
mdx:
    format: 'md'
---

> One record, exactly as the writers were shown it

<details>
<summary>Attributes (6)</summary>

| Attribute    | Type     | Required | Description                                                                              |
| ------------ | -------- | -------- | ---------------------------------------------------------------------------------------- |
| `title`      | `string` | Yes      |                                                                                          |
| `artist`     | `string` | Yes      | The lead, as it should be read                                                           |
| `trackId`    | `string` | No       | The catalog row, when the station holds this copy. Absent for a record it has never seen |
| `year`       | `number` | No       |                                                                                          |
| `album`      | `string` | No       |                                                                                          |
| `durationMs` | `number` | No       |                                                                                          |

</details>
