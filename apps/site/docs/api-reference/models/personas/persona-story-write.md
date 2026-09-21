---
title: 'PersonaStoryWrite'
sidebar_position: 13
mdx:
    format: 'md'
---

> A story an operator is writing by hand. Always active and always theirs; a proposal is something only the enrichment pass creates

<details>
<summary>Attributes (3)</summary>

| Attribute | Type                           | Required | Description                                                                                                   |
| --------- | ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| `title`   | `string`                       | Yes      |                                                                                                               |
| `story`   | `string`                       | Yes      |                                                                                                               |
| `kind`    | `'anecdote' \| 'arc' \| 'bit'` | No       | What sort of thing this is. Absent means `anecdote`, which is what every story written before arcs existed is |

</details>
