---
title: 'Create invitation'
sidebar_label: 'Create invitation'
sidebar_position: 2
mdx:
    format: 'md'
---

Invite somebody into a role. An open invitation to the same address is withdrawn first, so this is also how one is sent again. Refused for an address that already has an account

**`POST`** `/invitations`

:::note
SDK method: `createInvitation`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [InvitationCreate](../models/users/invitation-create.md) object.

## Response

`201 Created` — Returns a [Invitation](../models/users/invitation.md) object.
