---
title: 'MessagingLinkCode'
sidebar_position: 1
mdx:
    format: 'md'
---

> A one-time code that links a chat account to the signed-in station account. Shown once: send it to the station's bot as `/link CODE` in a direct message

<details>
<summary>Attributes (2)</summary>

| Attribute   | Type     | Required | Description                                                      |
| ----------- | -------- | -------- | ---------------------------------------------------------------- |
| `code`      | `string` | Yes      | The code itself. Case does not matter when it is sent            |
| `expiresAt` | `string` | Yes      | When the code stops working. A new code replaces any earlier one |

</details>
