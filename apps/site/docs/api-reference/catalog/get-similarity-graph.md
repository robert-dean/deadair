---
title: 'Get similarity graph'
sidebar_label: 'Get similarity graph'
sidebar_position: 31
mdx:
    format: 'md'
---

Who the similarity sources say resembles whom, as the station has stored it. Without `around`, the best-ranked edges of the whole store; with it, the neighbourhood of one artist

**`GET`** `/catalog/similarity`

:::note
SDK method: `getSimilarityGraph`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (4)</summary>

| Attribute | Type      | Required | Description                                                                          |
| --------- | --------- | -------- | ------------------------------------------------------------------------------------ |
| `around`  | `string`  | No       | A catalog artist to centre on. Absent draws the whole store, best-ranked edges first |
| `depth`   | `number`  | No       | How many steps out from `around`, following edges either way. Ignored without it     |
| `library` | `boolean` | No       | Only artists the catalog holds, on both ends of every edge                           |
| `limit`   | `number`  | No       | The most edges answered                                                              |

</details>

## Response

`200 OK` — Returns a [SimilarityGraph](../models/catalog/similarity-graph.md) object.
