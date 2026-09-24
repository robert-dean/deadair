---
title: 'MessagingLink'
sidebar_position: 2
mdx:
    format: 'md'
---

> A chat account linked to the signed-in station account. Operator commands sent from it run with this account's permissions

<details>
<summary>Attributes (4)</summary>

| Attribute        | Type     | Required | Description                                                                   |
| ---------------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `pluginId`       | `string` | Yes      | Which messaging plugin the chat account is on, for example `deadair.telegram` |
| `platformUserId` | `string` | Yes      | The chat platform's own id for the person                                     |
| `displayName`    | `string` | Yes      | What the chat platform called them when they linked                           |
| `createdAt`      | `string` | Yes      | When the link was made                                                        |

</details>
