---
title: 'Start fetcher authorization'
sidebar_label: 'Start fetcher authorization'
sidebar_position: 3
mdx:
    format: 'md'
---

Starts the fetcher's one-time authorization and answers with the URL to open. Starting another replaces whichever was pending

**`POST`** `/stream/authorization`

:::note
SDK method: `startFetcherAuthorization`
Security: authenticated (policy: platform.manage)
:::

## Response

`201 Created` — Returns a [FetcherAuthorizationStart](../models/stream/fetcher-authorization-start.md) object.
