---
title: 'Start login'
sidebar_label: 'Start login'
sidebar_position: 4
mdx:
    format: 'md'
---

Start a password-less login process

**`POST`** `/auth/login/start`

:::note
SDK method: `startLogin`
Security: public
:::

## Request body (`application/json`)

Accepts a [AuthenticationLoginStart](../models/authentication/authentication-login-start.md) object.

## Response

`200 OK` — Returns a [AuthenticationLoginStartResponse](../models/authentication/authentication-login-start-response.md) object.
