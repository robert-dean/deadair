---
title: 'Read fetcher authorization'
sidebar_label: 'Read fetcher authorization'
sidebar_position: 2
mdx:
    format: 'md'
---

What the track fetcher holds by way of a Spotify login, and whether an authorization is already waiting to be finished

**`GET`** `/stream/authorization`

:::note
SDK method: `readFetcherAuthorization`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [FetcherAuthorization](../models/stream/fetcher-authorization.md) object.
