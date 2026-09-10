---
title: 'Request token'
sidebar_label: 'Request token'
sidebar_position: 1
mdx:
    format: 'md'
---

Request authenticated token

**`POST`** `/auth/token`

:::note
SDK method: `requestToken`
Security: public
:::

## Request body (`application/x-www-form-urlencoded`)

Accepts a [AuthenticationRequest](../models/authentication/authentication-request.md) object.

## Request body (`application/json`)

Accepts a [AuthenticationRequest](../models/authentication/authentication-request.md) object.

## Response

`201 Created` — Returns a [AuthenticationTokenResponse](../models/authentication/authentication-token-response.md) object.
