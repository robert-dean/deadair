---
title: 'Approve authorization request'
sidebar_label: 'Approve authorization request'
sidebar_position: 2
mdx:
    format: 'md'
---

Let the app act as the signed-in person. Once the account has a strong second factor, this needs one verified in the last five minutes

**`POST`** `/auth/oauth/authorize/approve`

:::note
SDK method: `approveAuthorizationRequest`
Security: authenticated (policy: platform.view)
:::

## Request body (`application/json`)

Accepts a [OAuthAuthorizationDecision](../models/oauth/oauth-authorization-decision.md) object.

## Response

`200 OK` — Returns a [OAuthAuthorizationOutcome](../models/oauth/oauth-authorization-outcome.md) object.
