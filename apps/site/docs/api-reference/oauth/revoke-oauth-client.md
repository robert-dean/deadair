---
title: 'Revoke oauth client'
sidebar_label: 'Revoke oauth client'
sidebar_position: 6
mdx:
    format: 'md'
---

Withdraw an app. Every person's approval of it ends, and so does every token it holds

**`DELETE`** `/auth/oauth/clients/{clientId}`

:::note
SDK method: `revokeOAuthClient`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute  | Type     | Required | Description     |
| ---------- | -------- | -------- | --------------- |
| `clientId` | `string` | Yes      | Path parameter. |

</details>

## Response

`204 No Content`
