---
title: 'Create own show'
sidebar_label: 'Create own show'
sidebar_position: 7
mdx:
    format: 'md'
---

Makes a new show. Nothing is made until an episode is asked for

**`POST`** `/podcasts/own`

:::note
SDK method: `createOwnShow`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [OwnShow](../models/podcasts/own-show.md) object.

## Response

`201 Created` — Returns a [OwnShow](../models/podcasts/own-show.md) object.
