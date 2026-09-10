---
title: 'PersonaRehearsal'
sidebar_position: 25
mdx:
    format: 'md'
---

> What a persona says when it is asked for a break it will never air

<details>
<summary>Attributes (7)</summary>

| Attribute   | Type                        | Required | Description                                                                                                                      |
| ----------- | --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `personaId` | `string`                    | Yes      |                                                                                                                                  |
| `previous`  | `string`                    | Yes      | The invented record the break follows. Fixed, so two readings of the same sheet can be compared                                  |
| `next`      | `string`                    | Yes      | The invented record it leads into                                                                                                |
| `attempts`  | `PersonaRehearsalAttempt[]` | Yes      |                                                                                                                                  |
| `script`    | `string`                    | No       | The words a listener would have heard, from whichever writer answered first                                                      |
| `writer`    | `string`                    | No       | Which one that was. Present exactly when `script` is                                                                             |
| `reason`    | `string`                    | No       | Why there are no words, when every writer had nothing. Not a fault: a break nothing could write is one the station does not take |

</details>
