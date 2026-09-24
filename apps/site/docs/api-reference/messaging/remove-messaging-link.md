---
title: 'Remove messaging link'
sidebar_label: 'Remove messaging link'
sidebar_position: 3
mdx:
    format: 'md'
---

Unlink a chat account. Its operator commands are refused from the next one on

**`DELETE`** `/messaging/links/{pluginId}/{platformUserId}`

:::note
SDK method: `removeMessagingLink`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute        | Type     | Required | Description     |
| ---------------- | -------- | -------- | --------------- |
| `platformUserId` | `string` | Yes      | Path parameter. |
| `pluginId`       | `string` | Yes      | Path parameter. |

</details>

## Response

`204 No Content`
