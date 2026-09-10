---
title: 'Replan the running order'
sidebar_label: 'Replan the running order'
sidebar_position: 11
mdx:
    format: 'md'
---

Queues a fresh set for everything the player is not already holding, and swaps it in once it exists. The old tail keeps playing until then, because emptying the running order first would take the station off air while the model was still choosing

**`POST`** `/director/air/replan`

:::note
SDK method: `replanTheRunningOrder`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [ReplanStationInput](../models/director/replan-station-input.md) object.

## Response

`202`
