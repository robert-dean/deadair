---
title: 'MixLink'
sidebar_position: 7
mdx:
    format: 'md'
---

> A wire from one node's output to another node's input, by socket number from 0

<details>
<summary>Attributes (4)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                                        |
| --------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`    | `string` | Yes      | The node the wire leaves                                                                                                                                                                                                                           |
| `out`     | `number` | Yes      | Which of its outputs: 0 for every node but a `split`, whose outputs are its branches in order and then "everything else". Each output takes one wire, and every record output has to lead somewhere: a loose one would drop records without a word |
| `to`      | `string` | Yes      | The node the wire enters                                                                                                                                                                                                                           |
| `in`      | `number` | Yes      | Which of its inputs: 0 is records for every node but `merge`, whose four inputs are 0 to 3 and take as many wires as reach them; a `limitShare`'s input 1 takes a number, from a `timeSwitch`, in place of its own `percent`                       |

</details>
