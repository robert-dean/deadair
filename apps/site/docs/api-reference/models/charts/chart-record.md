---
title: 'ChartRecord'
sidebar_position: 3
mdx:
    format: 'md'
---

> One record's place in a chart

<details>
<summary>Attributes (8)</summary>

| Attribute   | Type       | Required | Description                                                       |
| ----------- | ---------- | -------- | ----------------------------------------------------------------- |
| `rank`      | `number`   | Yes      |                                                                   |
| `title`     | `string`   | Yes      |                                                                   |
| `artist`    | `string`   | Yes      | The lead artist alone. The other credits are in `featuring`       |
| `featuring` | `string[]` | No       |                                                                   |
| `album`     | `string`   | No       |                                                                   |
| `year`      | `number`   | No       |                                                                   |
| `peak`      | `number`   | No       | Best position this record has reached, where the source tracks it |
| `weeksOn`   | `number`   | No       | How many editions it has appeared in, where the source tracks it  |

</details>
