---
title: 'SilenceCheck'
sidebar_position: 8
mdx:
    format: 'md'
---

> One gate's answer about itself

<details>
<summary>Attributes (4)</summary>

| Attribute | Type           | Required | Description                                                                |
| --------- | -------------- | -------- | -------------------------------------------------------------------------- |
| `code`    | `SilenceCause` | Yes      | Never `airing`, which is the absence of a blocking gate rather than a gate |
| `state`   | `SilenceState` | Yes      |                                                                            |
| `detail`  | `string`       | Yes      | What this gate is doing right now, whether or not it is the one blocking   |
| `remedy`  | `string`       | No       | What would clear it, where there is something an operator can actually do  |

</details>
