---
title: 'PersonaRehearsalAttempt'
sidebar_position: 24
mdx:
    format: 'md'
---

> One writer's turn at a rehearsal. Every writer asked is reported and not only the one that won: a
> model that declined and a floor that covered for it are two facts, and the second on its own reads
> as a station that never had a model configured

<details>
<summary>Attributes (5)</summary>

| Attribute    | Type     | Required | Description                                                                                                                                 |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `writer`     | `string` | Yes      | Which binding was asked, as `segments.writer` would record it                                                                               |
| `outcome`    | `string` | Yes      | written, declined or failed. Declined is the station working; failed is something to go and fix                                             |
| `durationMs` | `number` | Yes      | Kept for every writer rather than only a slow one: "the model got slower" can only be asked of numbers gathered before anybody suspected it |
| `script`     | `string` | No       | What it produced, when it produced anything usable                                                                                          |
| `reason`     | `string` | No       | Why it did not, when it did not. A sentence, because its destination is a person                                                            |

</details>
