---
title: 'Reactivate user'
sidebar_label: 'Reactivate user'
sidebar_position: 5
mdx:
    format: 'md'
---

Switch a person back on. They sign in as they did before, and their API keys, connected apps and chat links work again

**`POST`** `/users/{id}/reactivate`

:::note
SDK method: `reactivateUser`
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

`200 OK` — Returns a [UserSummary](../models/users/user-summary.md) object.
