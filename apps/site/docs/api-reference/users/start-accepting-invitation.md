---
title: 'Start accepting invitation'
sidebar_label: 'Start accepting invitation'
sidebar_position: 5
mdx:
    format: 'md'
---

Check the password and start setting up the second step. Nothing is saved, and starting again replaces the setup

**`POST`** `/invitations/accept/start`

:::note
SDK method: `startAcceptingInvitation`
Security: public
:::

## Request body (`application/json`)

Accepts a [InvitationAcceptStart](../models/users/invitation-accept-start.md) object.

## Response

`200 OK` — Returns a [InvitationAcceptStartResponse](../models/users/invitation-accept-start-response.md) object.
