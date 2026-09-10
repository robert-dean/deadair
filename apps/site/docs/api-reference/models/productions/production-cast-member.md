---
title: 'ProductionCastMember'
sidebar_position: 1
mdx:
    format: 'md'
---

> One person in a production: the presenter, or somebody cast to phone in. A snapshot rather than a
> reference, because the persona it names may be edited or deleted while the programme is still being
> made and what the turns were written as has to be what an operator reads back

<details>
<summary>Attributes (3)</summary>

| Attribute | Type                 | Required | Description                                       |
| --------- | -------------------- | -------- | ------------------------------------------------- |
| `role`    | `'host' \| 'caller'` | Yes      |                                                   |
| `name`    | `string`             | No       | What they are called on air                       |
| `persona` | `string`             | No       | The persona key, for a link back to the character |

</details>
