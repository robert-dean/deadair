---
title: 'Revoke oauth grant'
sidebar_label: 'Revoke oauth grant'
sidebar_position: 8
mdx:
    format: 'md'
---

Disconnect an app. Every token it holds for this person stops working at once

**`DELETE`** `/auth/oauth/grants/{id}`

:::note
SDK method: `revokeOAuthGrant`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`204 No Content`
