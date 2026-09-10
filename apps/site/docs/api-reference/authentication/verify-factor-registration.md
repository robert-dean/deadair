---
title: 'Verify factor registration'
sidebar_label: 'Verify factor registration'
sidebar_position: 7
mdx:
    format: 'md'
---

Verify an authentication factor registration

**`POST`** `/auth/factors/verify`

:::note
SDK method: `verifyFactorRegistration`
Security: authenticated (policy: none)
:::

## Request body (`application/json`)

Accepts a [AuthenticationFactorRegistrationVerification](../models/authentication/authentication-factor-registration-verification.md) object.

## Response

`201 Created` — Returns a [AuthenticationToken](../models/authentication/authentication-token.md) object.
