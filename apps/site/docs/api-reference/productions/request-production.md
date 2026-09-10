---
title: 'Request production'
sidebar_label: 'Request production'
sidebar_position: 2
mdx:
    format: 'md'
---

Asks the station to make one. It is queued, not started

**`POST`** `/productions`

:::note
SDK method: `requestProduction`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [ProductionRequest](../models/productions/production-request.md) object.

## Response

`201 Created` — Returns a [Production](../models/productions/production.md) object.
