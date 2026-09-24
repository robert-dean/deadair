---
title: 'Create request'
sidebar_label: 'Create request'
sidebar_position: 3
mdx:
    format: 'md'
---

Ask the station to play a record. Answers with the request whatever became of it, so a refusal says why in `reason`

**`POST`** `/requests`

:::note
SDK method: `createRequest`
Security: authenticated (policy: platform.view)
:::

## Request body (`application/json`)

Accepts a [ListenerRequestCreate](../models/requests/listener-request-create.md) object.

## Response

`201 Created` — Returns a [ListenerRequest](../models/requests/listener-request.md) object.
