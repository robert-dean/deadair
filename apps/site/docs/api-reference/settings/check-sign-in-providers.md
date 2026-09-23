---
title: 'Check sign-in providers'
sidebar_label: 'Check sign-in providers'
sidebar_position: 3
mdx:
    format: 'md'
---

Asks each identity provider in the sign-in settings for its discovery document, the way a sign-in would, and says which answered

**`GET`** `/settings/signin/check`

:::note
SDK method: `checkSignInProviders`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [SigninProvidersCheck](../models/settings/signin-providers-check.md) object.
