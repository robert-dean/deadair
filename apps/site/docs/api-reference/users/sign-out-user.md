---
title: 'Sign out user'
sidebar_label: 'Sign out user'
sidebar_position: 9
mdx:
    format: 'md'
---

Sign a person out everywhere. They can sign straight back in

**`POST`** `/users/{id}/sign-out`

:::note
SDK method: `signOutUser`
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
