---
title: 'EventTestResult'
sidebar_position: 9
mdx:
    format: 'md'
---

> What a test delivery came to

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type      | Required | Description                                            |
| ------------ | --------- | -------- | ------------------------------------------------------ |
| `delivered`  | `boolean` | Yes      |                                                        |
| `httpStatus` | `number`  | No       | What the destination answered, when it answered at all |
| `durationMs` | `number`  | Yes      |                                                        |
| `error`      | `string`  | No       | Why it was not delivered, in the station's words       |

</details>
