---
title: 'Disarm the live input'
sidebar_label: 'Disarm the live input'
sidebar_position: 10
mdx:
    format: 'md'
---

Disarms the live input. A presenter on the air is handed back to the station at once

**`POST`** `/playout/live/disarm`

:::note
SDK method: `disarmTheLiveInput`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.

`409 Conflict`
