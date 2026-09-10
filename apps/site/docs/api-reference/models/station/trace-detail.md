---
title: 'TraceDetail'
sidebar_position: 18
mdx:
    format: 'md'
---

> One decision, its calls, and the decisions on either side of it

<details>
<summary>Attributes (4)</summary>

| Attribute  | Type              | Required | Description                                                            |
| ---------- | ----------------- | -------- | ---------------------------------------------------------------------- |
| `decision` | `TraceDecision`   | Yes      |                                                                        |
| `spans`    | `TraceSpan[]`     | Yes      | In the order they happened                                             |
| `parent`   | `TraceDecision`   | No       | What enqueued this, when that decision is still inside the kept window |
| `caused`   | `TraceDecision[]` | Yes      | What this one went on to enqueue                                       |

</details>
