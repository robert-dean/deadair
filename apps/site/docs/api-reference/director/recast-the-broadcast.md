---
title: 'Recast the broadcast'
sidebar_label: 'Recast the broadcast'
sidebar_position: 9
mdx:
    format: 'md'
---

Changes who is presenting this broadcast. Breaks already written for it in the outgoing character are written again in the new one

**`PUT`** `/director/air/persona`

:::note
SDK method: `recastTheBroadcast`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [SetStationHostInput](../models/director/set-station-host-input.md) object.

## Response

`200 OK` — Returns a [StationOrder](../models/director/station-order.md) object.
