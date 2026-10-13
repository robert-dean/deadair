---
title: 'Reset user MFA'
sidebar_label: 'Reset user MFA'
sidebar_position: 7
mdx:
    format: 'md'
---

Remove a person's authenticator apps and passkeys and sign them out everywhere, for when they have lost the device. They sign in with their password and set a new one up

**`POST`** `/users/{id}/mfa/reset`

:::note
SDK method: `resetUserMFA`
Security: authenticated (policy: platform.manage)
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
