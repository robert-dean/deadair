---
title: 'Pronunciation'
sidebar_position: 21
mdx:
    format: 'md'
---

> One name the station says differently from how it is written

<details>
<summary>Attributes (10)</summary>

| Attribute     | Type                                    | Required | Description                                                                                                                                                             |
| ------------- | --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string`                                | Yes      |                                                                                                                                                                         |
| `written`     | `string`                                | Yes      | What appears in a script. Matched case-insensitively, and whole words only                                                                                              |
| `spoken`      | `string`                                | Yes      | What the engine is handed instead, untouched. EMPTY is meaningful: it drops the words, which is the honest reading for a marker that got into a title and is not a word |
| `state`       | `'active' \| 'suggested' \| 'rejected'` | Yes      | `active` is said. `suggested` is proposed and says nothing yet. `rejected` outlives the pass that proposed it, or the same article proposes it again forever            |
| `origin`      | `'operator' \| 'gloss'`                 | Yes      | Who says so. `gloss` is a pronunciation key an encyclopaedia article printed for itself                                                                                 |
| `sourceUrl`   | `string`                                | No       | The article. Present on anything an operator did not type                                                                                                               |
| `sourceQuote` | `string`                                | No       | The sentence that says so, as it stands in the article, which is what the decision is actually made on                                                                  |
| `subjectKind` | `'track' \| 'album' \| 'artist'`        | No       | What the article was about                                                                                                                                              |
| `subjectId`   | `string`                                | No       |                                                                                                                                                                         |
| `createdAt`   | `string`                                | Yes      |                                                                                                                                                                         |

</details>
