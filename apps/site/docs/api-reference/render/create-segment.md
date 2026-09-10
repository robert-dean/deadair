---
title: 'Create segment'
sidebar_label: 'Create segment'
sidebar_position: 2
mdx:
    format: 'md'
---

Plans something for the station to say, and starts rendering it

**`POST`** `/segments`

:::note
SDK method: `createSegment`
Security: authenticated (policy: platform.manage)
:::

## Request body (`application/json`)

Accepts a [SegmentCreate](../models/render/segment-create.md) object.

## Response

`201 Created` — Returns a [Segment](../models/render/segment.md) object.
