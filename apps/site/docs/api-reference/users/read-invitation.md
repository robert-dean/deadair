---
title: 'Read invitation'
sidebar_label: 'Read invitation'
sidebar_position: 4
mdx:
    format: 'md'
---

What an open invitation is for: the address, the role and the station. Changes nothing

**`POST`** `/invitations/accept/details`

:::note
SDK method: `readInvitation`
Security: public
:::

## Request body (`application/json`)

Accepts a [InvitationToken](../models/users/invitation-token.md) object.

## Response

`200 OK` — Returns a [InvitationDetails](../models/users/invitation-details.md) object.
