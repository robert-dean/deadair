---
title: 'SimilarityGraphQuery'
sidebar_position: 45
mdx:
    format: 'md'
---

> Which part of the similarity store to draw.

<details>
<summary>Attributes (4)</summary>

| Attribute | Type      | Required | Description                                                                                      |
| --------- | --------- | -------- | ------------------------------------------------------------------------------------------------ |
| `around`  | `string`  | No       | A catalog artist to centre on. Absent draws the whole store, best-ranked edges first             |
| `depth`   | `number`  | Yes      | How many steps out from `around`, following edges either way. Ignored without it. _default: `1`_ |
| `library` | `boolean` | Yes      | Only artists the catalog holds, on both ends of every edge. _default: `false`_                   |
| `limit`   | `number`  | Yes      | The most edges answered. _default: `500`_                                                        |

</details>
