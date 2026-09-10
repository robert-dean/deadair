---
title: 'Register login'
sidebar_label: 'Register login'
sidebar_position: 2
mdx:
    format: 'md'
---

Register a new login

**`POST`** `/auth/login/register`

:::note
SDK method: `registerLogin`
Security: public
:::

## Request body (`application/json`)

Accepts a [AuthenticationRegistration](../models/authentication/authentication-registration.md) object.

## Response

`201 Created` — Returns a [AuthenticationRegistration](../models/authentication/authentication-registration.md) object.
