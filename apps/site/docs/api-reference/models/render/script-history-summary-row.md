---
title: 'ScriptHistorySummaryRow'
sidebar_position: 18
mdx:
    format: 'md'
---

> One presenter's attempts in the window

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type     | Required | Description                                                                                         |
| ------------ | -------- | -------- | --------------------------------------------------------------------------------------------------- |
| `personaKey` | `string` | No       | Absent means nobody was presenting, which is an ordinary state rather than a gap in the data        |
| `written`    | `number` | Yes      |                                                                                                     |
| `declined`   | `number` | Yes      | A decline is the writer registry working: the model had nothing to say and the floor covered for it |
| `failed`     | `number` | Yes      |                                                                                                     |

</details>
