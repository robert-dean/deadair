---
title: 'Get user'
sidebar_label: 'Get user'
sidebar_position: 8
mdx:
    format: 'md'
---

One person, with every way they sign in, where they are signed in and their recent sign-ins

**`GET`** `/users/{id}`

:::note
SDK method: `getUser`
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

`200 OK` — Returns a [UserDetail](../models/users/user-detail.md) object.
