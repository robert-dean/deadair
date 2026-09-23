---
title: 'List sign-in providers'
sidebar_label: 'List sign-in providers'
sidebar_position: 9
mdx:
    format: 'md'
---

The identity providers the sign-in page offers beside a password, in the order the operator listed them. Empty when none is set up

**`GET`** `/auth/login/oidc/providers`

:::note
SDK method: `listSignInProviders`
Security: public
:::

## Response

`200 OK` — Returns a list of [OidcProviderSummary](../models/authentication/oidc-provider-summary.md) objects.
