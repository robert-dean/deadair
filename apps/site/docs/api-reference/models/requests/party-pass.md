---
title: 'PartyPass'
sidebar_position: 10
mdx:
    format: 'md'
---

> A party: the pass guests join with by scanning its QR code, for as long as it lasts

<details>
<summary>Attributes (4)</summary>

| Attribute   | Type     | Required | Description                                                                                                                                                                                                     |
| ----------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`     | `string` | Yes      | The pass itself. Put it after `#` on the station's `/party` page, as `/party#<token>`, and that address is what the QR code holds. Anyone holding it can join until the party ends, so show it only to the room |
| `createdAt` | `string` | Yes      | When the party started                                                                                                                                                                                          |
| `expiresAt` | `string` | Yes      | When the pass stops letting guests in, and turns away every guest who joined with it                                                                                                                            |
| `guests`    | `number` | Yes      | How many guests have joined with it                                                                                                                                                                             |

</details>
