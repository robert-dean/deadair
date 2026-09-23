---
title: 'Deny authorization request'
sidebar_label: 'Deny authorization request'
sidebar_position: 3
mdx:
    format: 'md'
---

Turn the app away. It is told the person said no

**`POST`** `/auth/oauth/authorize/deny`

:::note
SDK method: `denyAuthorizationRequest`
Security: authenticated (policy: platform.view)
:::

## Request body (`application/json`)

Accepts a [OAuthAuthorizationDecision](../models/oauth/oauth-authorization-decision.md) object.

## Response

`200 OK` — Returns a [OAuthAuthorizationOutcome](../models/oauth/oauth-authorization-outcome.md) object.
