---
title: 'List factors'
sidebar_label: 'List factors'
sidebar_position: 5
mdx:
    format: 'md'
---

List authentication factors

**`GET`** `/auth/factors`

:::note
SDK method: `listFactors`
Security: authenticated (policy: none)
:::

## Response

`200 OK` — Returns a list of [AuthenticationFactor](../models/authentication/authentication-factor.md) objects.
