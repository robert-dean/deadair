---
title: 'Create api key'
sidebar_label: 'Create api key'
sidebar_position: 2
mdx:
    format: 'md'
---

Issue a new API key for the signed-in account. The token is in this response and nowhere else, ever. Once the account has a strong second factor, this needs one verified in the last five minutes

**`POST`** `/auth/apikeys`

:::note
SDK method: `createAPIKey`
Security: authenticated (policy: platform.view)
:::

## Request body (`application/json`)

Accepts a [ApiKeyCreate](../models/authentication/api-key-create.md) object.

## Response

`201 Created` — Returns a [ApiKeyIssued](../models/authentication/api-key-issued.md) object.
