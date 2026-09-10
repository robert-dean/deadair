---
title: 'PersonaAuditionSummary'
sidebar_position: 30
mdx:
    format: 'md'
---

> A run of one character over one playlist, without its breaks: what a list draws

<details>
<summary>Attributes (11)</summary>

| Attribute     | Type                                                         | Required | Description                                                  |
| ------------- | ------------------------------------------------------------ | -------- | ------------------------------------------------------------ |
| `id`          | `string`                                                     | Yes      |                                                              |
| `personaId`   | `string`                                                     | Yes      |                                                              |
| `personaKey`  | `string`                                                     | Yes      | The character's own key, as `script_history` records it      |
| `source`      | `PersonaAuditionSource`                                      | Yes      |                                                              |
| `state`       | `'queued' \| 'running' \| 'done' \| 'failed' \| 'cancelled'` | Yes      | `cancelled` keeps whatever breaks were already written       |
| `transitions` | `number`                                                     | Yes      | How many breaks this run writes in total                     |
| `written`     | `number`                                                     | Yes      | How many it has written so far, which is how far along it is |
| `error`       | `string`                                                     | No       | Why writing it stopped, when it did                          |
| `cancelledAt` | `string`                                                     | No       | ISO-8601                                                     |
| `finishedAt`  | `string`                                                     | No       | ISO-8601, whichever way the run ended                        |
| `createdAt`   | `string`                                                     | Yes      | ISO-8601                                                     |

</details>
