---
title: 'Deactivate user'
sidebar_label: 'Deactivate user'
sidebar_position: 10
mdx:
    format: 'md'
---

Switch a person off. They are signed out everywhere and cannot sign in, and their API keys, connected apps and chat links stop working, until they are switched back on. Nothing is deleted. Refused for your own account, and for the last admin

**`POST`** `/users/{id}/deactivate`

:::note
SDK method: `deactivateUser`
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
