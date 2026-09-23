---
title: 'Create oauth client'
sidebar_label: 'Create oauth client'
sidebar_position: 5
mdx:
    format: 'md'
---

Register an app by hand. The secret, for an app that keeps one, is in this response and nowhere else

**`POST`** `/auth/oauth/clients`

:::note
SDK method: `createOAuthClient`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [OAuthClientCreate](../models/oauth/oauth-client-create.md) object.

## Response

`201 Created` — Returns a [OAuthClientIssued](../models/oauth/oauth-client-issued.md) object.
