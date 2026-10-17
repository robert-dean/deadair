---
title: 'MetricPoint'
sidebar_position: 3
mdx:
    format: 'md'
---

> One series over one minute or hour

<details>
<summary>Attributes (6)</summary>

| Attribute | Type     | Required | Description                                                       |
| --------- | -------- | -------- | ----------------------------------------------------------------- |
| `at`      | `string` | Yes      | The start of the minute or hour                                   |
| `count`   | `number` | Yes      | How many observations were folded in                              |
| `sum`     | `number` | Yes      | Their total: a counter's value, or with `count` a duration's mean |
| `min`     | `number` | Yes      | The smallest observation                                          |
| `max`     | `number` | Yes      | The largest observation: a duration's worst                       |
| `last`    | `number` | Yes      | The latest observation: a gauge's value                           |

</details>
