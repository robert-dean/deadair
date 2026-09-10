---
title: 'PersonaNote'
sidebar_position: 6
mdx:
    format: 'md'
---

> One thing this character has accumulated that its sheet does not hold. Two kinds and they are two
> different claims: `said` records something it actually put on air and carries the script as its
> evidence, so it is a record and goes straight into use; `trait` infers who the character is
> becoming, which nothing can verify, so a model's arrives `suggested` and the operator is the check

<details>
<summary>Attributes (9)</summary>

| Attribute        | Type                                    | Required | Description                                                                                                                                               |
| ---------------- | --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string`                                | Yes      | _read-only_                                                                                                                                               |
| `kind`           | `'said' \| 'trait'`                     | Yes      | `said` is what this character did, rendered beside the show's memory. `trait` is who it has become, rendered beside the sheet                             |
| `note`           | `string`                                | Yes      | One sentence, because it shares a system turn with the grounding rules                                                                                    |
| `state`          | `'active' \| 'suggested' \| 'rejected'` | Yes      | `active` is carried into breaks. `rejected` outlives the pass that proposed it, or the same scripts propose it again forever. _read-only_                 |
| `origin`         | `'operator' \| 'model'`                 | Yes      | Who says so. `model` is the distil pass reading this character's own history back. _read-only_                                                            |
| `sourceScriptId` | `string`                                | No       | The attempt this was drawn from, while that row still exists. The nightly sweep takes it and the quote below stays. _read-only_                           |
| `sourceQuote`    | `string`                                | No       | The words that support it, as the station said them. What an operator actually accepts or rejects on, and required of anything a model wrote. _read-only_ |
| `lastUsedAt`     | `string`                                | No       | When it was last carried into a break. Absent means never, which is what puts it at the front of the rotation. _read-only_                                |
| `createdAt`      | `string`                                | Yes      | _read-only_                                                                                                                                               |

</details>
