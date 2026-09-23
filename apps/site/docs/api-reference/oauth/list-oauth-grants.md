---
title: 'List oauth grants'
sidebar_label: 'List oauth grants'
sidebar_position: 7
mdx:
    format: 'md'
---

The apps the signed-in person has let act as them

**`GET`** `/auth/oauth/grants`

:::note
SDK method: `listOAuthGrants`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [OAuthGrantList](../models/oauth/oauth-grant-list.md) object.
