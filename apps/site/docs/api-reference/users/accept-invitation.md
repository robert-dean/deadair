---
title: 'Accept invitation'
sidebar_label: 'Accept invitation'
sidebar_position: 6
mdx:
    format: 'md'
---

Accept: make the account with its password, its second step and its role, all at once, and spend the invitation

**`POST`** `/invitations/accept`

:::note
SDK method: `acceptInvitation`
Security: public
:::

## Request body (`application/json`)

Accepts a [InvitationAccept](../models/users/invitation-accept.md) object.

## Response

`201 Created` — Returns a [InvitationAccepted](../models/users/invitation-accepted.md) object.
