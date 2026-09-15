---
title: 'List api keys'
sidebar_label: 'List api keys'
sidebar_position: 1
mdx:
    format: 'md'
---

The signed-in account's API keys, newest first, including revoked and expired ones so the list says what was withdrawn and when

**`GET`** `/auth/apikeys`

:::note
SDK method: `listAPIKeys`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [ApiKeyList](../models/authentication/api-key-list.md) object.
