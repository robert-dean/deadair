---
title: 'MetricName'
sidebar_position: 6
mdx:
    format: 'md'
---

> A metric the station holds, for a picker

<details>
<summary>Attributes (4)</summary>

| Attribute   | Type       | Required | Description                                        |
| ----------- | ---------- | -------- | -------------------------------------------------- |
| `name`      | `string`   | Yes      |                                                    |
| `source`    | `string`   | Yes      |                                                    |
| `labelKeys` | `string[]` | Yes      | Every label any of its series carries, sorted      |
| `lastSeen`  | `string`   | Yes      | The newest point held for it, at either resolution |

</details>
