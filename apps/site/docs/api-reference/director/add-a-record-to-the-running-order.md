---
title: 'Add a record to the running order'
sidebar_label: 'Add a record to the running order'
sidebar_position: 16
mdx:
    format: 'md'
---

Puts a catalog record into the running order. A record whose audio is not local yet is refused here rather than accepted and held or skipped when its slot comes round, so an operator asking for a specific one is told why it cannot play. What makes this worth having on its own is undo: dropping an item only ever marks a segment, but a track is spliced out of the order entirely, so nothing could put one back until this existed

**`POST`** `/director/air/tracks`

:::note
SDK method: `addARecordToTheRunningOrder`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [AddStationTrackInput](../models/director/add-station-track-input.md) object.

## Response

`200 OK` — Returns a [StationOrder](../models/director/station-order.md) object.
