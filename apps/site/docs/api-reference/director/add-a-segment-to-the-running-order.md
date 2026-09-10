---
title: 'Add a segment to the running order'
sidebar_label: 'Add a segment to the running order'
sidebar_position: 15
mdx:
    format: 'md'
---

Puts something the station says into the running order. A segment with no audio yet is refused here rather than accepted and skipped when it comes round, so an operator is told why it cannot play

**`POST`** `/director/air/segments`

:::note
SDK method: `addASegmentToTheRunningOrder`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [AddStationSegmentInput](../models/director/add-station-segment-input.md) object.

## Response

`200 OK` — Returns a [StationOrder](../models/director/station-order.md) object.
