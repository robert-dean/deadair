---
title: 'Describe authorization request'
sidebar_label: 'Describe authorization request'
sidebar_position: 1
mdx:
    format: 'md'
---

Validate an app's authorization request for the consent page, and stash it for the signed-in person. A POST because it stashes: what is approved is exactly what was validated here

**`POST`** `/auth/oauth/authorize/context`

:::note
SDK method: `describeAuthorizationRequest`
Security: authenticated (policy: platform.view)
:::

## Request body (`application/json`)

Accepts a [OAuthAuthorizationQuery](../models/oauth/oauth-authorization-query.md) object.

## Response

`200 OK` — Returns a [OAuthAuthorizationContextResult](../models/oauth/oauth-authorization-context-result.md) object.
