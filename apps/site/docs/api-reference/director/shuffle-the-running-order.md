---
title: 'Shuffle the running order'
sidebar_label: 'Shuffle the running order'
sidebar_position: 14
mdx:
    format: 'md'
---

Shuffles the records not yet handed to the player, and plants the breaks again around the new sequence. The head is already in the player's hands and is left alone

**`POST`** `/director/air/shuffle`

:::note
SDK method: `shuffleTheRunningOrder`
Security: authenticated (policy: platform.manage)
:::

## Response

`200 OK` — Returns a [StationOrder](../models/director/station-order.md) object.
