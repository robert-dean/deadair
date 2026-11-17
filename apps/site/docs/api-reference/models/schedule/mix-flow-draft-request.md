---
title: 'MixFlowDraftRequest'
sidebar_position: 11
mdx:
    format: 'md'
---

> What a show's mix flow is drafted from: the show's brief as the operator has it now, saved or not, and any answers to the questions an earlier draft asked

<details>
<summary>Attributes (2)</summary>

| Attribute | Type               | Required | Description                                                                                        |
| --------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `brief`   | `string`           | Yes      | The show's brief, in the operator's own words                                                      |
| `answers` | `MixDraftAnswer[]` | No       | Answers to the questions an earlier draft of the same brief asked, so the next one can settle them |

</details>
