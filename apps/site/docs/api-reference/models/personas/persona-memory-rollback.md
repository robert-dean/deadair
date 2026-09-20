---
title: 'PersonaMemoryRollback'
sidebar_position: 39
mdx:
    format: 'md'
---

> Undo what this character accumulated on its own

<details>
<summary>Attributes (2)</summary>

| Attribute | Type      | Required | Description                                                                                                                                                                         |
| --------- | --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`      | `string`  | No       | The moment to go back to, as a timeline row reports it. Absent means all of it, which is a reset                                                                                    |
| `relearn` | `boolean` | No       | Also drag the distil pass's watermark back, so it reads that window again. Right for testing and wrong for undoing a character that drifted, so it is asked for rather than assumed |

</details>
