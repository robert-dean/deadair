---
title: 'FestivalAct'
sidebar_position: 2
mdx:
    format: 'md'
---

> One act on a festival's bill

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type      | Required | Description                                                                                                   |
| ----------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `artist`    | `string`  | Yes      | As the station credits them, which is the name said on air and the name the station looks their records up by |
| `day`       | `string`  | No       | The day they play, as `YYYY-MM-DD`, when the bill says. Inside the festival's dates                           |
| `headliner` | `boolean` | No       | Whether they top the bill. Absent is no                                                                       |

</details>
