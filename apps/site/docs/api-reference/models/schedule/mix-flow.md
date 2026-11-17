---
title: 'MixFlow'
sidebar_position: 6
mdx:
    format: 'md'
---

> A show's mix flow: nodes and the wires between them, as the console's canvas draws them. Records enter at the one `picks` node and leave at the one `onAir` node; a record the station proposes is followed down the wires, and the first node that holds it (a `block`, or a limit it would take past its amount) keeps it off the air. `require` nodes add a record when they fall due. A record a listener asked for, and what follows it, is never judged and never counted

<details>
<summary>Attributes (3)</summary>

| Attribute | Type        | Required | Description                   |
| --------- | ----------- | -------- | ----------------------------- |
| `version` | `number`    | Yes      | The shape of this document. 1 |
| `nodes`   | `MixNode[]` | Yes      |                               |
| `links`   | `MixLink[]` | Yes      | The wires                     |

</details>
