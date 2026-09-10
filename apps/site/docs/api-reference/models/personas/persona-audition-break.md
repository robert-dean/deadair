---
title: 'PersonaAuditionBreak'
sidebar_position: 29
mdx:
    format: 'md'
---

> One transition, and everything the writers said about it. Every writer asked is reported and not
> only the one that won, on the rehearsal's own argument: a model that declined and a floor that
> covered for it are two facts

<details>
<summary>Attributes (7)</summary>

| Attribute  | Type                        | Required | Description                                                                     |
| ---------- | --------------------------- | -------- | ------------------------------------------------------------------------------- |
| `ordinal`  | `number`                    | Yes      | Which transition, from 0                                                        |
| `previous` | `PersonaAuditionRecord`     | Yes      | The record this break follows                                                   |
| `next`     | `PersonaAuditionRecord`     | Yes      | The one it leads into                                                           |
| `attempts` | `PersonaRehearsalAttempt[]` | Yes      |                                                                                 |
| `script`   | `string`                    | No       | The words a listener would have heard, from whichever writer answered first     |
| `writer`   | `string`                    | No       | Which one that was. Present exactly when `script` is                            |
| `reason`   | `string`                    | No       | Why there are none, when every writer had nothing. On air this break is skipped |

</details>
