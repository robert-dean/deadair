---
title: 'SimilarityEdge'
sidebar_position: 47
mdx:
    format: 'md'
---

> One artist naming another as a neighbour. DIRECTED: that A lists B says nothing about whether B
> lists A, and both rows are answered when both exist.

<details>
<summary>Attributes (5)</summary>

| Attribute | Type     | Required | Description                                                                                                |
| --------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `from`    | `string` | Yes      | The key of the artist whose neighbours these are. _read-only_                                              |
| `to`      | `string` | Yes      | The key of the neighbour. _read-only_                                                                      |
| `rank`    | `number` | Yes      | Position in `from`'s merged answer, from 0. The one weight comparable across sources. _read-only_          |
| `match`   | `number` | No       | The source's own score, comparable only inside that source's answer. Absent when it gave none. _read-only_ |
| `source`  | `string` | Yes      | The plugin id whose answer named this neighbour first. _read-only_                                         |

</details>
