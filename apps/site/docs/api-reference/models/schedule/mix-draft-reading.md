---
title: 'MixDraftReading'
sidebar_position: 14
mdx:
    format: 'md'
---

> One phrase of a brief and what the draft made of it

<details>
<summary>Attributes (5)</summary>

| Attribute  | Type       | Required | Description                                                                                                    |
| ---------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `quote`    | `string`   | Yes      | The phrase, as the brief has it                                                                                |
| `note`     | `string`   | Yes      | What it became, in plain words, or why it became nothing                                                       |
| `nodeIds`  | `string[]` | No       | The nodes drawn from it. Absent for a phrase about taste, which is left to the picks                           |
| `question` | `string`   | No       | Asked when the phrase could mean more than one thing. The draft made its best guess, and answering redrafts it |
| `options`  | `string[]` | No       | Answers to offer for `question`                                                                                |

</details>
