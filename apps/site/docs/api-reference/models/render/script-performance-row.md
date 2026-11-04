---
title: 'ScriptPerformanceRow'
sidebar_position: 24
mdx:
    format: 'md'
---

> One presenter's writing of one kind of break, and what the operator thought of it

<details>
<summary>Attributes (9)</summary>

| Attribute        | Type                    | Required | Description                                                                                  |
| ---------------- | ----------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `personaKey`     | `string`                | No       | Absent means nobody was presenting, which is an ordinary state rather than a gap in the data |
| `kind`           | `string`                | Yes      |                                                                                              |
| `written`        | `number`                | Yes      |                                                                                              |
| `declined`       | `number`                | Yes      |                                                                                              |
| `failed`         | `number`                | Yes      |                                                                                              |
| `liked`          | `number`                | Yes      |                                                                                              |
| `neutral`        | `number`                | Yes      |                                                                                              |
| `disliked`       | `number`                | Yes      |                                                                                              |
| `declineReasons` | `ScriptDeclineReason[]` | Yes      | Most common first                                                                            |

</details>
