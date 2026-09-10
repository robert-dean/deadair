---
title: 'HoldStationInput'
sidebar_position: 7
mdx:
    format: 'md'
---

> How long to keep the schedule off the running order

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                          |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `minutes` | `number` | No       | How long the hold lasts, from now. ABSENT means until it is released by hand, which is the answer for an operator who does not know yet — a day is the ceiling because a hold nobody remembers setting is worse than one that lapses |

</details>
