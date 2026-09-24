---
title: 'Approve authorization request'
sidebar_label: 'Approve authorization request'
sidebar_position: 2
mdx:
    format: 'md'
---

Let the app act as the signed-in person, as far as the chosen scopes allow. Once the account has a strong second factor, this needs one verified in the last five minutes

**`POST`** `/auth/oauth/authorize/approve`

:::note
SDK method: `approveAuthorizationRequest`
Security: authenticated (policy: platform.view)
:::

## Request body (`application/json`)

Accepts a [OAuthAuthorizationApproval](../models/oauth/oauth-authorization-approval.md) object.

## Response

`200 OK` — Returns a [OAuthAuthorizationOutcome](../models/oauth/oauth-authorization-outcome.md) object.
