---
title: 'Verify login registration'
sidebar_label: 'Verify login registration'
sidebar_position: 3
mdx:
    format: 'md'
---

Verify a login registration

**`POST`** `/auth/login/verify`

:::note
SDK method: `verifyLoginRegistration`
Security: public
:::

## Request body (`application/json`)

Accepts a [AuthenticationRegistrationVerification](../models/authentication/authentication-registration-verification.md) object.

## Response

`201 Created` — Returns a [AuthenticationToken](../models/authentication/authentication-token.md) object.
