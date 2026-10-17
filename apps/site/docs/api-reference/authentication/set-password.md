---
title: 'Set password'
sidebar_label: 'Set password'
sidebar_position: 12
mdx:
    format: 'md'
---

Set or change the caller's own password. Needs the current one when there is one, unless a sign-in link was used in the last ten minutes, and a recent strong-factor verification once an authenticator or passkey is enrolled. Every other session of the account is signed out, and the account's email addresses are told.

**`PUT`** `/auth/password`

:::note
SDK method: `setPassword`
Security: authenticated (policy: none)
:::

## Request body (`application/json`)

Accepts a [PasswordChange](../models/authentication/password-change.md) object.

## Response

`204 No Content`
