---
title: 'TraceSpan'
sidebar_position: 14
mdx:
    format: 'md'
---

> One call inside a decision, and what it cost

<details>
<summary>Attributes (7)</summary>

| Attribute | Type                      | Required | Description                                                                               |
| --------- | ------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `at`      | `string`                  | Yes      | When the call ended, which is when its cost was known                                     |
| `op`      | `string`                  | Yes      | Dotted and stable: `job.run`, `plugin.invoke`, `llm.generate`                             |
| `target`  | `string`                  | No       | Which one: a plugin and its method, or a model                                            |
| `ms`      | `number`                  | Yes      | How long it held, measured around the call rather than reported by it                     |
| `outcome` | `TraceOutcome`            | Yes      |                                                                                           |
| `error`   | `string`                  | No       | The failure, summarized to a shape rather than a stack                                    |
| `detail`  | `Record<string, unknown>` | No       | Whatever this `op` is worth reading back: tokens, a finish reason, the bound it was given |

</details>
