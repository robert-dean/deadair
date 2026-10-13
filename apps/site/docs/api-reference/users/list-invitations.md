---
title: 'List invitations'
sidebar_label: 'List invitations'
sidebar_position: 1
mdx:
    format: 'md'
---

Every invitation, newest first, with the link of each one still open

**`GET`** `/invitations`

:::note
SDK method: `listInvitations`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [InvitationList](../models/users/invitation-list.md) object.
