---
title: 'SimilarityGraph'
sidebar_position: 48
mdx:
    format: 'md'
---

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type               | Required | Description                                          |
| ----------- | ------------------ | -------- | ---------------------------------------------------- |
| `nodes`     | `SimilarityNode[]` | Yes      | Every artist an edge names, once. _read-only_        |
| `edges`     | `SimilarityEdge[]` | Yes      | _read-only_                                          |
| `truncated` | `boolean`          | Yes      | More edges matched than `limit` allowed. _read-only_ |

</details>
