---
title: 'Revoke invitation'
sidebar_label: 'Revoke invitation'
sidebar_position: 3
mdx:
    format: 'md'
---

Withdraw an invitation. Its link stops working at once. Nothing is deleted: it stays in the list as withdrawn

**`DELETE`** `/invitations/{id}`

:::note
SDK method: `revokeInvitation`
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

`200 OK` — Returns a [Invitation](../models/users/invitation.md) object.
