---
title: 'Change user role'
sidebar_label: 'Change user role'
sidebar_position: 6
mdx:
    format: 'md'
---

Give a person a different role. They hold exactly one, so the role they had is taken away. Refused for your own account, and for the last admin

**`PUT`** `/users/{id}/role`

:::note
SDK method: `changeUserRole`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [UserRoleChange](../models/users/user-role-change.md) object.

## Response

`200 OK` — Returns a [UserSummary](../models/users/user-summary.md) object.
