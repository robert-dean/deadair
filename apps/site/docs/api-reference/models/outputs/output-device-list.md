---
title: 'OutputDeviceList'
sidebar_position: 4
mdx:
    format: 'md'
---

> Every speaker every `output` plugin can play the station on

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type              | Required | Description                                                                                               |
| ---------- | ----------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `devices`  | `OutputDevice[]`  | Yes      |                                                                                                           |
| `problems` | `OutputProblem[]` | Yes      | Plugins that did not answer. Their speakers are missing from `devices` rather than the whole list failing |

</details>
