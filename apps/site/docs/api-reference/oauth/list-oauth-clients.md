---
title: 'List oauth clients'
sidebar_label: 'List oauth clients'
sidebar_position: 4
mdx:
    format: 'md'
---

Every app registered with the station, by an operator or by itself

**`GET`** `/auth/oauth/clients`

:::note
SDK method: `listOAuthClients`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [OAuthClientList](../models/oauth/oauth-client-list.md) object.
