---
title: 'Extend the running order'
sidebar_label: 'Extend the running order'
sidebar_position: 10
mdx:
    format: 'md'
---

Queues a refill and returns at once. Generating a set walks the catalog, and an operator pressing a button should not be held open through it

**`POST`** `/director/air/extend`

:::note
SDK method: `extendTheRunningOrder`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [ExtendStationInput](../models/director/extend-station-input.md) object.

## Response

`202`
