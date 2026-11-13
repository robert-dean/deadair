---
title: 'Reorder occasions'
sidebar_label: 'Reorder occasions'
sidebar_position: 7
mdx:
    format: 'md'
---

Puts the list in a new order, which decides who wins when two fall on one date

**`PUT`** `/occasions/order`

:::note
SDK method: `reorderOccasions`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [OccasionOrder](../models/schedule/occasion-order.md) object.

## Response

`200 OK` — Returns a [OccasionList](../models/schedule/occasion-list.md) object.
