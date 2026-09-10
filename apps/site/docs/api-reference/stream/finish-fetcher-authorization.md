---
title: 'Finish fetcher authorization'
sidebar_label: 'Finish fetcher authorization'
sidebar_position: 4
mdx:
    format: 'md'
---

Finishes an authorization from the address the operator's browser ended up at

**`POST`** `/stream/authorization/complete`

:::note
SDK method: `finishFetcherAuthorization`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [FetcherAuthorizationInput](../models/stream/fetcher-authorization-input.md) object.

## Response

`200 OK` — Returns a [FetcherAuthorizationFinished](../models/stream/fetcher-authorization-finished.md) object.
