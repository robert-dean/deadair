---
title: 'Get the running order'
sidebar_label: 'Get the running order'
sidebar_position: 8
mdx:
    format: 'md'
---

The live running order, item by item, each saying where it has got to

**`GET`** `/director/air/order`

:::note
SDK method: `getTheRunningOrder`
Security: authenticated (policy: platform.view)
:::

## Response

`200 OK` — Returns a [StationOrder](../models/director/station-order.md) object.
