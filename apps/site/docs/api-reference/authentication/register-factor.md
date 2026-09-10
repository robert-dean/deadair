---
title: 'Register factor'
sidebar_label: 'Register factor'
sidebar_position: 6
mdx:
    format: 'md'
---

Register an authentication factor

**`POST`** `/auth/factors/register`

:::note
SDK method: `registerFactor`
Security: authenticated (policy: none)
:::

## Request body (`application/json`)

Accepts a [AuthenticationFactorRegistration](../models/authentication/authentication-factor-registration.md) object.

## Response

`201 Created` — Returns a [AuthenticationFactorRegistrationResponse](../models/authentication/authentication-factor-registration-response.md) object.
